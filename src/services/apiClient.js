// src/services/apiClient.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin wrapper around fetch() that:
//   - Prepends the API base URL automatically
//   - Attaches the auth token from localStorage (if present)
//   - Throws a typed ApiError on non-2xx responses
//   - Enforces a configurable request timeout
//
// All other service files import from here — nowhere else calls fetch() directly.
// ─────────────────────────────────────────────────────────────────────────────
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config/env'

// ── Custom error class ────────────────────────────────────────────────────────
// Thrown whenever the server responds with a non-2xx status.
// Components can catch this and inspect `.status` or `.data` for details.
export class ApiError extends Error {
  /**
   * @param {number} status   - HTTP status code, e.g. 404
   * @param {string} message  - Human-readable error message
   * @param {any}    data     - Parsed response body (if available)
   */
  constructor(status, message, data = null) {
    super(message)
    this.name    = 'ApiError'
    this.status  = status
    this.data    = data
  }
}

// ── Token helpers ─────────────────────────────────────────────────────────────
// Token is stored in localStorage so it survives page refreshes.
// Replace these with your own auth strategy (cookie, session, etc.) if needed.

/** Save the bearer token after a successful login */
export function setAuthToken(token) {
  localStorage.setItem('auth_token', token)
}

/** Clear the token on logout */
export function clearAuthToken() {
  localStorage.removeItem('auth_token')
}

/** Read the current token (or null if not logged in) */
export function getAuthToken() {
  return localStorage.getItem('auth_token')
}

// ── Core request function ─────────────────────────────────────────────────────

/**
 * Make an authenticated HTTP request.
 *
 * @param {string} path     - Path relative to API_BASE_URL, e.g. "/api/chats"
 * @param {object} options  - Standard fetch() options (method, body, headers…)
 * @returns {Promise<any>}  - Parsed JSON response body
 * @throws {ApiError}       - On non-2xx status
 * @throws {Error}          - On network failure or timeout
 */
export async function request(path, options = {}) {
  const url   = `${API_BASE_URL}${path}`
  const token = getAuthToken()

  // Build headers — always send JSON, attach token if we have one
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  // AbortController lets us cancel the request after REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    })
  } catch (err) {
    // Network failure or abort (timeout)
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${path}`)
    }
    throw new Error(`Network error: ${err.message}`)
  } finally {
    clearTimeout(timeoutId)
  }

  // Parse body — try JSON first, fall back to plain text
  let body
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    body = await response.json()
  } else {
    body = await response.text()
  }

  // Throw on non-2xx so callers don't need to check response.ok manually
  if (!response.ok) {
    const message =
      (typeof body === 'object' && body?.message) ||
      (typeof body === 'object' && body?.error)  ||
      `HTTP ${response.status}`
    throw new ApiError(response.status, message, body)
  }

  return body
}

// ── Convenience method shortcuts ──────────────────────────────────────────────

/** GET /path */
export const get = (path, options = {}) =>
  request(path, { ...options, method: 'GET' })

/** POST /path with a JSON body */
export const post = (path, data, options = {}) =>
  request(path, { ...options, method: 'POST', body: JSON.stringify(data) })

/** PUT /path with a JSON body */
export const put = (path, data, options = {}) =>
  request(path, { ...options, method: 'PUT', body: JSON.stringify(data) })

/** DELETE /path */
export const del = (path, options = {}) =>
  request(path, { ...options, method: 'DELETE' })