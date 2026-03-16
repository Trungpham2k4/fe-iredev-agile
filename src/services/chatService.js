// src/services/chatService.js
// ─────────────────────────────────────────────────────────────────────────────
// All REST API calls related to conversations and messages.
//
// Every function maps 1-to-1 to a backend endpoint.
// Components never call apiClient directly — they go through here.
//
// Expected backend contract
// ─────────────────────────
//
//  GET    /api/chats                   → Chat[]
//  POST   /api/chats                   → Chat         body: { title }
//  DELETE /api/chats/:chatId           → { ok: true }
//
//  GET    /api/chats/:chatId/messages  → Message[]
//  POST   /api/chats/:chatId/messages  → Message      body: { role, content }
//
//  POST   /api/auth/login              → { token, user }  body: { email, password }
//  POST   /api/auth/logout             → { ok: true }
//
// Chat shape:    { id, title, date, createdAt }
// Message shape: { id, chatId, role, content, artifact?, createdAt }
// ─────────────────────────────────────────────────────────────────────────────
import { get, post, del, setAuthToken, clearAuthToken } from './apiClient'

// ── Authentication ────────────────────────────────────────────────────────────

/**
 * Log in with email + password.
 * Saves the returned token to localStorage via apiClient.
 *
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function login(credentials) {
  const result = await post('/api/auth/login', credentials)
  setAuthToken(result.token)
  return result
}

/**
 * Log out — clears the local token and tells the server.
 */
export async function logout() {
  try {
    await post('/api/auth/logout', {})
  } finally {
    // Always clear the local token, even if the server call fails
    clearAuthToken()
  }
}

// ── Conversations ─────────────────────────────────────────────────────────────

/**
 * Fetch all conversations for the current user (used to populate the sidebar).
 *
 * @returns {Promise<Chat[]>}
 */
export async function fetchChats() {
  return get('/api/chats')
}

/**
 * Create a new conversation on the server.
 *
 * @param {string} title - Initial title derived from the first message
 * @returns {Promise<Chat>}
 */
export async function createChat(title) {
  return post('/api/chats', { title })
}

/**
 * Delete a conversation and all its messages.
 *
 * @param {string} chatId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deleteChat(chatId) {
  return del(`/api/chats/${chatId}`)
}

// ── Messages ──────────────────────────────────────────────────────────────────

/**
 * Fetch the full message history for a conversation.
 * Called when the user clicks an existing chat in the sidebar.
 *
 * @param {string} chatId
 * @returns {Promise<Message[]>}
 */
export async function fetchMessages(chatId) {
  return get(`/api/chats/${chatId}/messages`)
}

/**
 * Persist a user message to the server.
 * The AI response is NOT returned here — it comes over the WebSocket.
 *
 * @param {string} chatId
 * @param {string} content - The user's message text
 * @returns {Promise<Message>} - The saved user message (with server-assigned id)
 */
export async function sendMessage(chatId, content) {
  return post(`/api/chats/${chatId}/messages`, { role: 'user', content })
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a new user account.
 * Saves the returned token to localStorage via apiClient.
 *
 * @param {{ name: string, email: string, password: string }} data
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function register(data) {
  const result = await post('/api/auth/register', data)
  setAuthToken(result.token)
  return result
}