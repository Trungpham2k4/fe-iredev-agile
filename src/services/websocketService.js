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

// =============================================================================
// WebSocket client singleton.
//
// FIXES applied:
//   1. connect() is guarded: does nothing if a connection is already OPEN or
//      CONNECTING — stops duplicate connections firing on every React render.
//   2. Reconnect only happens for unexpected closes (code !== 1000 AND 1001).
//      Code 1001 = "going away" (page reload) — should not trigger reconnect.
//   3. Added isConnecting state to prevent race where connect() is called
//      twice before the socket reaches OPEN.
//   4. Debug logging added so connection lifecycle is visible in the browser
//      console.
// =============================================================================
 
import { WS_BASE_URL, WS_RECONNECT_DELAY_MS } from '../config/env'
 
export class WebSocketService {
  constructor() {
    this._socket          = null
    this._handlers        = {}
    this._reconnectTimer  = null
    this._shouldReconnect = false
    this._token           = null
  }
 
  /**
   * Open the WebSocket connection.
   * Safe to call multiple times — does nothing if already open or connecting.
   *
   * @param {string} token  JWT — passed explicitly (not read from localStorage)
   */
  connect(token) {
    if (!token) {
      console.warn('[WS] connect() called without token — skipping')
      return
    }
 
    // Guard: do nothing if already open or in the middle of connecting
    const state = this._socket?.readyState
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
      console.debug('[WS] Already connected/connecting — skipping duplicate connect()')
      return
    }
 
    this._token           = token
    this._shouldReconnect = true
    this._openSocket()
  }
 
  /**
   * Close the connection intentionally (no auto-reconnect).
   * Call on logout.
   */
  close() {
    this._shouldReconnect = false
    this._token           = null
    clearTimeout(this._reconnectTimer)
    if (this._socket) {
      this._socket.close(1000, 'Client logout')
      this._socket = null
    }
  }
 
  /**
   * Register a handler for an event type.
   * Returns an unsubscribe function.
   */
  on(eventType, handler) {
    if (!this._handlers[eventType]) {
      this._handlers[eventType] = new Set()
    }
    this._handlers[eventType].add(handler)
    return () => this._handlers[eventType]?.delete(handler)
  }
 
  /** Send a JSON payload. Logs a warning if the socket is not open. */
  send(payload) {
    if (this._socket?.readyState === WebSocket.OPEN) {
      this._socket.send(JSON.stringify(payload))
    } else {
      console.warn('[WS] Cannot send — not connected. readyState:',
        this._socket?.readyState, 'Payload:', payload)
    }
  }
 
  sendChatMessage(chatId, messageId, content) {
    this.send({ type: 'chat_message', chatId, messageId, content })
  }
 
  stopStream(chatId) {
    this.send({ type: 'stop_stream', chatId })
  }
 
  ping() {
    this.send({ type: 'ping' })
  }
 
  get isConnected() {
    return this._socket?.readyState === WebSocket.OPEN
  }
 
  // ---------------------------------------------------------------------------
  _openSocket() {
    const url = `${WS_BASE_URL}/ws?token=${encodeURIComponent(this._token)}`
    console.info('[WS] Opening connection to', url)
 
    this._socket = new WebSocket(url)
 
    this._socket.onopen = () => {
      console.info('[WS] Connected ✓')
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
 
      // Reconnect only on unexpected drops.
      // Code 1000 = normal close (intentional).
      // Code 1001 = going away (page navigation).
      // Code 1008 = policy violation (bad token) — don't reconnect with same token.
      const shouldReconnect = (
        this._shouldReconnect &&
        this._token &&
        event.code !== 1000 &&
        event.code !== 1001 &&
        event.code !== 1008
      )
 
      if (shouldReconnect) {
        console.info(`[WS] Reconnecting in ${WS_RECONNECT_DELAY_MS}ms…`)
        this._reconnectTimer = setTimeout(
          () => this._openSocket(),
          WS_RECONNECT_DELAY_MS,
        )
      }
    }
 
    this._socket.onerror = (err) => {
      console.error('[WS] Socket error:', err)
      this._emit('_error', {})
      // onclose always fires after onerror — reconnect is handled there
    }
  }
 
  _emit(eventType, payload) {
    this._handlers[eventType]?.forEach((handler) => {
      try {
        handler(payload)
      } catch (err) {
        console.error(`[WS] Handler threw for "${eventType}":`, err)
      }
    })
  }
}
 
export const wsService = new WebSocketService()