// src/hooks/useChat.js
// =============================================================================
// Central chat state hook.
//
// Data flow:
//   Mount             → GET /api/chats               load sidebar
//   selectChat(id)    → GET /api/chats/:id/messages   load history
//   sendMessage(text) →
//     1. POST /api/chats          (if no active chat — creates one)
//     2. Show user bubble + assistant placeholder immediately (optimistic)
//     3. POST /api/chats/:id/messages   (saves user message → returns saved msg)
//     4. wsService.sendChatMessage()    (server streams tokens via WebSocket)
//     WS "token"    → append to assistant bubble
//     WS "done"     → remove streaming cursor
//     WS "artifact" → attach artifact card
//     WS "error"    → show error text
//   cancelStream()  → wsService.stopStream()
// =============================================================================
import { useState, useCallback, useEffect, useRef } from 'react'
import { useWebSocket }  from './useWebSocket'
import { wsService }     from '../services/websocketService'
import {
  fetchChats    as apiFetchChats,
  createChat    as apiCreateChat,
  deleteChat    as apiDeleteChat,
  fetchMessages as apiFetchMessages,
  sendMessage   as apiSendMessage,
} from '../services/chatService'
import { SAMPLE_CHATS } from '../data/sampleData'
import { uid }          from '../utils/helpers'

export function useChat() {
  const [chats,           setChats]           = useState([])
  const [activeChatId,    setActiveChatId]    = useState(null)
  const [messages,        setMessages]        = useState([])
  const [streaming,       setStreaming]       = useState(false)
  const [openArtifact,    setOpenArtifact]    = useState(null)
  const [loadingChats,    setLoadingChats]    = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error,           setError]           = useState(null)
  const [wsConnected,     setWsConnected]     = useState(false)

  // Stable ref so WS callbacks always see the latest chatId
  const activeChatIdRef = useRef(activeChatId)
  useEffect(() => { activeChatIdRef.current = activeChatId }, [activeChatId])

  // Ref to the current placeholder ID so WS callbacks can find the right bubble
  const placeholderIdRef = useRef(null)

  // ── WebSocket event handlers ───────────────────────────────────────────────

  const handleToken = useCallback(({ chatId, messageId, token }) => {
    // Ignore tokens for a different chat (user may have switched chats)
    if (chatId !== activeChatIdRef.current) return

    setMessages((prev) =>
      prev.map((m) => {
        // Match by explicit messageId OR by our placeholder ID on first token
        if (m.id === messageId || m.id === placeholderIdRef.current) {
          // On first token, adopt the server's messageId as the real ID
          return { ...m, id: messageId, content: m.content + token }
        }
        return m
      })
    )
  }, [])

  const handleDone = useCallback(({ chatId, messageId }) => {
    if (chatId !== activeChatIdRef.current) return

    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId || m.id === placeholderIdRef.current
          ? { ...m, id: messageId, streaming: false }
          : m
      )
    )
    placeholderIdRef.current = null
    setStreaming(false)
  }, [])

  const handleError = useCallback(({ chatId, messageId, error: serverError }) => {
    if (chatId !== activeChatIdRef.current) return

    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId || m.id === placeholderIdRef.current
          ? {
              ...m,
              content:   `⚠️ ${serverError || 'Something went wrong.'}`,
              streaming: false,
              isError:   true,
            }
          : m
      )
    )
    placeholderIdRef.current = null
    setStreaming(false)
    setError(serverError || 'Failed to get a response.')
  }, [])

  const handleArtifact = useCallback(({ chatId, messageId, artifact }) => {
    if (chatId !== activeChatIdRef.current) return

    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId || m.id === placeholderIdRef.current
          ? { ...m, artifact }
          : m
      )
    )
  }, [])

  // Register WS handlers (does NOT open the connection — AuthContext does that)
  useWebSocket({
    onToken:       handleToken,
    onDone:        handleDone,
    onError:       handleError,
    onArtifact:    handleArtifact,
    onConnected:   () => setWsConnected(true),
    onDisconnected:() => setWsConnected(false),
  })

  // ── Load sidebar on mount ──────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetchChats()
        setChats(data)
      } catch (err) {
        console.warn('[useChat] fetchChats failed — using sample data:', err.message)
        setChats(SAMPLE_CHATS)
      } finally {
        setLoadingChats(false)
      }
    }
    load()
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────

  const newChat = useCallback(() => {
    if (activeChatId) wsService.stopStream(activeChatId)
    placeholderIdRef.current = null
    setActiveChatId(null)
    setMessages([])
    setOpenArtifact(null)
    setError(null)
    setStreaming(false)
  }, [activeChatId])

  const selectChat = useCallback(async (id) => {
    if (id === activeChatId) return
    if (activeChatId) wsService.stopStream(activeChatId)
    placeholderIdRef.current = null

    setActiveChatId(id)
    setMessages([])
    setOpenArtifact(null)
    setError(null)
    setStreaming(false)
    setLoadingMessages(true)

    try {
      const data = await apiFetchMessages(id)
      setMessages(data)
    } catch (err) {
      setError('Could not load messages. Please try again.')
    } finally {
      setLoadingMessages(false)
    }
  }, [activeChatId])

  const deleteChat = useCallback(async (id) => {
    if (id === activeChatId) {
      wsService.stopStream(id)
      placeholderIdRef.current = null
      setActiveChatId(null)
      setMessages([])
      setOpenArtifact(null)
      setStreaming(false)
    }
    setChats((prev) => prev.filter((c) => c.id !== id))
    try {
      await apiDeleteChat(id)
    } catch {
      try { setChats(await apiFetchChats()) } catch {}
    }
  }, [activeChatId])

  const cancelStream = useCallback(() => {
    if (activeChatId) wsService.stopStream(activeChatId)
    setStreaming(false)
    setMessages((prev) =>
      prev.map((m) => m.streaming ? { ...m, streaming: false } : m)
    )
    placeholderIdRef.current = null
  }, [activeChatId])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || streaming) return
    setError(null)

    const trimmed = text.trim()
    let chatId    = activeChatId

    // ── Create new chat if on home screen ─────────────────────────────────────
    if (!chatId) {
      const title  = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '')
      const tempId = `temp_${uid()}`

      setChats((prev) => [{ id: tempId, title, date: 'Today' }, ...prev])
      setActiveChatId(tempId)
      chatId = tempId

      try {
        const serverChat = await apiCreateChat(title)
        setChats((prev) => prev.map((c) => c.id === tempId ? serverChat : c))
        setActiveChatId(serverChat.id)
        chatId = serverChat.id
      } catch (err) {
        setChats((prev) => prev.filter((c) => c.id !== tempId))
        setActiveChatId(null)
        setError('Could not create conversation. Please try again.')
        return
      }
    }

    // ── Show user bubble immediately ───────────────────────────────────────────
    const localUserMsgId = `local_${uid()}`
    setMessages((prev) => [...prev, {
      id:      localUserMsgId,
      role:    'user',
      content: trimmed,
    }])

    // ── Add empty assistant placeholder with blinking cursor ───────────────────
    const placeholderId = `ph_${uid()}`
    placeholderIdRef.current = placeholderId   // tracked in ref for WS callbacks

    setMessages((prev) => [...prev, {
      id:        placeholderId,
      role:      'assistant',
      content:   '',
      streaming: true,
    }])
    setStreaming(true)

    // ── Save user message via REST, then trigger WS streaming ─────────────────
    try {
      const savedMsg = await apiSendMessage(chatId, trimmed)

      // Replace the optimistic local message with the server-confirmed version
      setMessages((prev) =>
        prev.map((m) => m.id === localUserMsgId ? savedMsg : m)
      )

      // Tell the backend to start generating the AI reply.
      // Tokens will arrive as WS "token" frames with messageId === placeholderId.
      wsService.sendChatMessage(chatId, placeholderId, trimmed)

    } catch (err) {
      console.error('[useChat] sendMessage REST failed:', err.message)
      setMessages((prev) => prev.filter((m) => m.id !== placeholderId))
      placeholderIdRef.current = null
      setStreaming(false)
      setError('Failed to send. Please try again.')
    }
  }, [activeChatId, streaming])

  return {
    chats, messages, activeChatId,
    streaming, openArtifact,
    loadingChats, loadingMessages,
    error, wsConnected,
    setOpenArtifact, setError,
    newChat, selectChat, deleteChat,
    sendMessage, cancelStream,
  }
}