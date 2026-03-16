// src/hooks/useChat.js
// =============================================================================
// Central chat state hook — handles streaming, artifacts, and feedback loop.
//
// WebSocket events handled:
//   token            → append to assistant bubble
//   done             → mark message finished
//   artifact         → attach artifact (awaitingFeedback=true → show feedback bar)
//   artifact_revised → update artifact with new version, still awaiting feedback
//   artifact_accepted→ mark artifact as accepted, hide feedback bar
//   artifact_timeout → auto-accepted after timeout
//   revision_start   → add new "Revising..." assistant message
//   error            → show error in bubble
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
import { useAuth }      from '../context/AuthContext'

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

  // authVersion from AuthContext — increments on every login.
  // We use it as a dependency so loadChats re-runs after logout→login.
  const { authVersion } = useAuth()

  const activeChatIdRef   = useRef(activeChatId)
  const placeholderIdRef  = useRef(null)   // current assistant placeholder id

  useEffect(() => { activeChatIdRef.current = activeChatId }, [activeChatId])

  // ── Helper: update a message by its id ────────────────────────────────────
  const updateMessage = useCallback((id, updater) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updater(m) } : m))
  }, [])

  // ── Helper: find message by id or placeholder ──────────────────────────────
  const findMessageId = useCallback((messageId) => {
    // Returns the id we should use to look up the message in state
    // (could be the server id or the placeholder id on first token)
    return messageId
  }, [])

  // ── WebSocket event handlers ───────────────────────────────────────────────

  // Each streamed word — append to the right bubble
  const handleToken = useCallback(({ chatId, messageId, token }) => {
    if (chatId !== activeChatIdRef.current) return
    setMessages(prev => prev.map(m => {
      if (m.id === messageId || m.id === placeholderIdRef.current) {
        return { ...m, id: messageId, content: m.content + token }
      }
      return m
    }))
  }, [])

  // Stream finished — remove cursor
  const handleDone = useCallback(({ chatId, messageId }) => {
    if (chatId !== activeChatIdRef.current) return
    setMessages(prev => prev.map(m =>
      m.id === messageId || m.id === placeholderIdRef.current
        ? { ...m, id: messageId, streaming: false }
        : m
    ))
    placeholderIdRef.current = null
    setStreaming(false)
  }, [])

  // New artifact arrived — attach to message, mark awaitingFeedback
  const handleArtifact = useCallback(({ chatId, messageId, artifact,
                                         awaitingFeedback, iteration, maxIterations }) => {
    if (chatId !== activeChatIdRef.current) return

    // Attach messageId to the artifact so sendArtifactFeedback can include it
    // in the artifact_feedback WS frame (backend needs it for routing).
    const enriched = { ...artifact, awaitingFeedback, iteration, maxIterations,
                        messageId, chatId }

    setMessages(prev => prev.map(m =>
      m.id === messageId || m.id === placeholderIdRef.current
        ? { ...m, artifact: enriched }
        : m
    ))

    // Auto-open the artifact panel so the user sees the feedback bar
    setOpenArtifact(enriched)
  }, [])

  // Revised artifact — update artifact on the same message bubble
  const handleArtifactRevised = useCallback(({ chatId, messageId, artifact,
                                                awaitingFeedback, iteration, maxIterations }) => {
    if (chatId !== activeChatIdRef.current) return

    const enriched = { ...artifact, awaitingFeedback, iteration, maxIterations,
                        messageId, chatId }

    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, artifact: enriched }
        : m
    ))
    setOpenArtifact(enriched)
  }, [])

  // Artifact accepted (by user or by auto-accept on timeout/max revisions)
  const handleArtifactAccepted = useCallback(({ chatId, messageId, artifactId, autoAccepted }) => {
    if (chatId !== activeChatIdRef.current) return

    // Mark the artifact on the message as accepted (removes feedback bar)
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m
      if (!m.artifact)        return m
      return {
        ...m,
        artifact: {
          ...m.artifact,
          accepted:         true,
          awaitingFeedback: false,
        }
      }
    }))

    // Update the open panel too
    setOpenArtifact(prev => {
      if (!prev) return null
      return { ...prev, accepted: true, awaitingFeedback: false }
    })
  }, [])

  // Feedback timed out — same treatment as accepted (backend auto-accepted)
  const handleArtifactTimeout = useCallback(({ chatId, messageId, artifactId }) => {
    if (chatId !== activeChatIdRef.current) return
    handleArtifactAccepted({ chatId, messageId, artifactId, autoAccepted: true })
  }, [handleArtifactAccepted])

  // Backend is about to stream revision tokens — add a new assistant bubble
  const handleRevisionStart = useCallback(({ chatId, messageId, comment, iteration }) => {
    if (chatId !== activeChatIdRef.current) return

    setMessages(prev => [...prev, {
      id:        messageId,
      role:      'assistant',
      content:   '',
      streaming: true,
      isRevision: true,
      revisionComment: comment,
      iteration,
    }])
    // Track this as the current placeholder so token handler can find it
    placeholderIdRef.current = messageId
    setStreaming(true)
  }, [])

  const handleWsError = useCallback(({ chatId, messageId, error: serverError }) => {
    if (chatId !== activeChatIdRef.current) return
    setMessages(prev => prev.map(m =>
      m.id === messageId || m.id === placeholderIdRef.current
        ? { ...m, content: `⚠️ ${serverError || 'Something went wrong.'}`,
            streaming: false, isError: true }
        : m
    ))
    placeholderIdRef.current = null
    setStreaming(false)
    setError(serverError || 'Failed to get a response.')
  }, [])

  // Wire up all WS handlers
  useWebSocket({
    onToken:           handleToken,
    onDone:            handleDone,
    onError:           handleWsError,
    onArtifact:        handleArtifact,
    onArtifactRevised: handleArtifactRevised,
    onArtifactAccepted:handleArtifactAccepted,
    onArtifactTimeout: handleArtifactTimeout,
    onRevisionStart:   handleRevisionStart,
    onConnected:       () => setWsConnected(true),
    onDisconnected:    () => setWsConnected(false),
  })

  // ── Load sidebar on mount ──────────────────────────────────────────────────
  useEffect(() => {
    // Skip the initial run when authVersion is 0 (not yet authenticated)
    if (authVersion === 0) return

    // Reset state so the sidebar shows the loading skeleton
    // instead of stale chats from the previous session
    setChats([])
    setActiveChatId(null)
    setMessages([])
    setOpenArtifact(null)
    setLoadingChats(true)

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
  }, [authVersion])  // re-runs every time the user logs in

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
    } catch {
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
    setChats(prev => prev.filter(c => c.id !== id))
    try { await apiDeleteChat(id) } catch {
      try { setChats(await apiFetchChats()) } catch {}
    }
  }, [activeChatId])

  const cancelStream = useCallback(() => {
    if (activeChatId) wsService.stopStream(activeChatId)
    setStreaming(false)
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m))
    placeholderIdRef.current = null
  }, [activeChatId])

  /**
   * Send a user message → saves via REST → triggers WS streaming.
   */
  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || streaming) return
    setError(null)

    const trimmed = text.trim()
    let chatId    = activeChatId

    // Create new chat if needed
    if (!chatId) {
      const title  = trimmed.slice(0, 50) + (trimmed.length > 50 ? '…' : '')
      const tempId = `temp_${uid()}`
      setChats(prev => [{ id: tempId, title, date: 'Today' }, ...prev])
      setActiveChatId(tempId)
      chatId = tempId
      try {
        const serverChat = await apiCreateChat(title)
        setChats(prev => prev.map(c => c.id === tempId ? serverChat : c))
        setActiveChatId(serverChat.id)
        chatId = serverChat.id
      } catch {
        setChats(prev => prev.filter(c => c.id !== tempId))
        setActiveChatId(null)
        setError('Could not create conversation. Please try again.')
        return
      }
    }

    // Optimistic user bubble
    const localUserMsgId = `local_${uid()}`
    setMessages(prev => [...prev, { id: localUserMsgId, role: 'user', content: trimmed }])

    // Empty assistant placeholder with cursor
    const placeholderId = `ph_${uid()}`
    placeholderIdRef.current = placeholderId
    setMessages(prev => [...prev, { id: placeholderId, role: 'assistant', content: '', streaming: true }])
    setStreaming(true)

    try {
      const savedMsg = await apiSendMessage(chatId, trimmed)
      setMessages(prev => prev.map(m => m.id === localUserMsgId ? savedMsg : m))
      wsService.sendChatMessage(chatId, placeholderId, trimmed)
    } catch (err) {
      setMessages(prev => prev.filter(m => m.id !== placeholderId))
      placeholderIdRef.current = null
      setStreaming(false)
      setError('Failed to send. Please try again.')
    }
  }, [activeChatId, streaming])

  /**
   * Send artifact feedback to the backend.
   * The backend is blocking on a threading.Event — this unblocks it.
   *
   * @param {'accept'|'revise'} action
   * @param {string} comment  - The revision request (empty string for accept)
   */
  // Ref that always points to the current openArtifact.
  // Using a ref here means sendArtifactFeedback never holds a stale closure
  // (deps array [activeChatId, openArtifact] would re-create the callback on
  //  every panel state change, but the ref always reads the latest value).
  const openArtifactRef = useRef(null)
  useEffect(() => { openArtifactRef.current = openArtifact }, [openArtifact])

  const sendArtifactFeedback = useCallback((action, comment = '') => {
    const art = openArtifactRef.current   // always the latest, never stale
    if (!art) {
      console.warn('[useChat] sendArtifactFeedback: no open artifact')
      return
    }

    // chatId and messageId were attached to the artifact object in handleArtifact.
    // artifactId is art.id which includes the version suffix (e.g. art_ph_abc_v1).
    const chatId    = art.chatId    || activeChatIdRef.current
    const messageId = art.messageId || ''

    console.debug('[useChat] sendArtifactFeedback', { action, comment, artifactId: art.id, chatId, messageId })

    wsService.send({
      type:       'artifact_feedback',
      chatId,
      messageId,
      artifactId: art.id,
      action,
      comment,
    })

    // Optimistic UI: hide the pulsing dot while waiting for backend response
    if (action === 'accept') {
      setOpenArtifact(prev => prev ? { ...prev, awaitingFeedback: false } : null)
    }
  }, [])   // stable — reads current values via refs

  return {
    chats, messages, activeChatId,
    streaming, openArtifact,
    loadingChats, loadingMessages,
    error, wsConnected,
    setOpenArtifact, setError,
    newChat, selectChat, deleteChat,
    sendMessage, cancelStream,
    sendArtifactFeedback,
  }
}