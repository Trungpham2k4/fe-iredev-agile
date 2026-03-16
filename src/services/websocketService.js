// src/services/websocketService.js
// =============================================================================
// Low-level WebSocket client — singleton used by the whole app.
//
// Key design points:
//   - connect(token) takes the token explicitly so it always uses a fresh
//     token, not a stale one captured at module load time.
//   - Auto-reconnects on unexpected close (not on intentional close()).
//   - Emits _connected / _disconnected internal events so React knows the state.
//
// Client → Server frames:
//   { type: "ping" }
//   { type: "chat_message", chatId, messageId, content }
//   { type: "stop_stream",  chatId }
//
// Server → Client frames:
//   { type: "connected",  userId }
//   { type: "pong" }
//   { type: "token",      chatId, messageId, token }
//   { type: "done",       chatId, messageId }
//   { type: "artifact",   chatId, messageId, artifact }
//   { type: "error",      chatId?, messageId?, error }
// =============================================================================

import { WS_BASE_URL, WS_RECONNECT_DELAY_MS } from '../config/env'

export class WebSocketService {
  constructor() {
    this._socket          = null   // native WebSocket instance
    this._handlers        = {}     // { eventType → Set<fn> }
    this._reconnectTimer  = null   // pending reconnect setTimeout id
    this._shouldReconnect = false  // false after intentional close()
    this._token           = null   // stored so reconnect uses the same token
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Open the WebSocket connection.
   *
   * @param {string} token  JWT from localStorage — passed explicitly so
   *                        reconnects always use the current token, not a
   *                        stale one captured at module-load time.
   */
  connect(token) {
    // Do nothing if already open
    if (this._socket?.readyState === WebSocket.OPEN) return

    if (!token) {
      console.warn('[WS] connect() called without a token — skipping')
      return
    }

    this._token           = token
    this._shouldReconnect = true
    this._openSocket()
  }

  /**
   * Close the connection permanently (no auto-reconnect).
   * Call this on logout.
   */
  close() {
    this._shouldReconnect = false
    this._token           = null
    clearTimeout(this._reconnectTimer)
    if (this._socket) {
      this._socket.close(1000, 'Client closed')
      this._socket = null
    }
  }

  /**
   * Register a handler for an event type.
   * Returns an unsubscribe function — call it to remove the handler.
   *
   * Event types:  'token' | 'done' | 'error' | 'artifact' | 'pong' |
   *               'connected' | '_connected' | '_disconnected'
   */
  on(eventType, handler) {
    if (!this._handlers[eventType]) {
      this._handlers[eventType] = new Set()
    }
    this._handlers[eventType].add(handler)
    return () => this._handlers[eventType]?.delete(handler)
  }

  /**
   * Send a JSON payload to the server.
   * Silently drops the message if the socket is not open.
   */
  send(payload) {
    if (this._socket?.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify(payload))
    } else {
      console.warn('[WS] Cannot send — socket not open. Payload:', payload)
    }
  }

  /** Tell the server to stream an AI reply for a message. */
  sendChatMessage(chatId, messageId, content) {
    this.send({ type: 'chat_message', chatId, messageId, content })
  }

  /** Tell the server to stop the current AI generation for a chat. */
  stopStream(chatId) {
    this.send({ type: 'stop_stream', chatId })
  }

  /** Send a keep-alive ping. */
  ping() {
    this.send({ type: 'ping' })
  }

  get isConnected() {
    return this._socket?.readyState === WebSocket.OPEN
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _openSocket() {
    const url = `${WS_BASE_URL}/ws?token=${encodeURIComponent(this._token)}`
    console.info('[WS] Connecting to', url)
    this._socket = new WebSocket(url)

    this._socket.onopen = () => {
      console.info('[WS] Socket open')
      this._emit('_connected', {})
    }

    this._socket.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch (err) {
        console.error('[WS] Failed to parse frame:', event.data, err)
        return
      }
      console.debug('[WS] ←', msg.type, msg)
      this._emit(msg.type, msg)
    }

    this._socket.onclose = (event) => {
      console.info(`[WS] Closed code=${event.code} reason="${event.reason}"`)
      this._emit('_disconnected', { code: event.code })

      // Auto-reconnect on unexpected disconnections (anything except our
      // intentional close with code 1000)
      if (this._shouldReconnect && event.code !== 1000 && this._token) {
        console.info(`[WS] Reconnecting in ${WS_RECONNECT_DELAY_MS}ms…`)
        this._reconnectTimer = setTimeout(
          () => this._openSocket(),
          WS_RECONNECT_DELAY_MS,
        )
      }
    }

    this._socket.onerror = (err) => {
      // onerror is always followed by onclose — let onclose handle reconnect
      console.error('[WS] Socket error:', err)
      this._emit('_error', {})
    }
  }

  _emit(eventType, payload) {
    this._handlers[eventType]?.forEach((handler) => {
      try {
        handler(payload)
      } catch (err) {
        console.error(`[WS] Handler threw for event "${eventType}":`, err)
      }
    })
  }
}

// Single shared instance for the whole app
export const wsService = new WebSocketService()