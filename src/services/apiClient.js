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

// =============================================================================
// HTTP client with automatic silent token refresh.
//
// Security model:
//   Access token  — lives in RAM (tokenStore.js), sent as Bearer header
//   Refresh token — HttpOnly cookie, browser sends it automatically
//
// On every 401 response:
//   1. Call POST /api/auth/refresh (browser sends refresh cookie automatically)
//   2. If successful → store new access token in RAM, retry the original request
//   3. If refresh fails → clear access token, fire onUnauthenticated() callbacks
//      (AuthContext listens and shows the login screen)
//
// Concurrent 401s:
//   If two requests fail simultaneously, only ONE refresh call is made.
//   The second waits for the first to complete (promise sharing).
// =============================================================================

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config/env'
import { getAccessToken, setAccessToken, clearAccessToken } from './tokenStore'

// ── Custom error class ────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message)
    this.name   = 'ApiError'
    this.status = status
    this.data   = data
  }
}

// ── Unauthenticated callbacks ─────────────────────────────────────────────────
// AuthContext registers a callback here so it can clear user state when
// a token refresh fails (session fully expired).
const _unauthCallbacks = new Set()

export function onUnauthenticated(fn)    { _unauthCallbacks.add(fn);    return () => _unauthCallbacks.delete(fn) }
function _fireUnauthenticated()          { _unauthCallbacks.forEach(fn => fn()) }

// ── Silent refresh state ──────────────────────────────────────────────────────
// Only one refresh call at a time. If two 401s arrive simultaneously,
// both wait on the same promise instead of firing two /refresh calls.
let _refreshPromise = null

async function _doRefresh() {
  try {
    // The browser automatically sends the HttpOnly refresh-token cookie.
    // No Authorization header needed — we don't have a valid access token yet.
    const resp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method:      'POST',
      credentials: 'include',   // send cookies cross-origin
      headers:     { 'Content-Type': 'application/json' },
    })

    if (!resp.ok) {
      // Refresh token expired or revoked — user must log in again
      clearAccessToken()
      _fireUnauthenticated()
      return false
    }

    const body = await resp.json()
    setAccessToken(body.access_token)
    return true

  } catch {
    clearAccessToken()
    _fireUnauthenticated()
    return false
  } finally {
    _refreshPromise = null   // allow the next refresh cycle
  }
}

function _refreshOnce() {
  if (!_refreshPromise) {
    _refreshPromise = _doRefresh()
  }
  return _refreshPromise
}

// ── Core request function ─────────────────────────────────────────────────────
/**
 * Make an authenticated HTTP request.
 * Automatically retries once after a silent token refresh on 401.
 *
 * @param {string}  path            - Relative path, e.g. "/api/chats"
 * @param {object}  options         - fetch() options
 * @param {boolean} _isRetry        - Internal: true on the retry after refresh
 */
export async function request(path, options = {}, _isRetry = false) {
  const url         = `${API_BASE_URL}${path}`
  const accessToken = getAccessToken()

  const headers = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...options.headers,
  }

  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',   // always send cookies (needed for refresh endpoint)
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request timed out: ${path}`)
    throw new Error(`Network error: ${err.message}`)
  } finally {
    clearTimeout(timeoutId)
  }

  // ── Silent refresh on 401 ─────────────────────────────────────────────────
  if (response.status === 401 && !_isRetry) {
    const refreshed = await _refreshOnce()
    if (refreshed) {
      // Retry the original request with the new access token
      return request(path, options, true)
    }
    // Refresh failed — throw 401 so the caller can handle it
    throw new ApiError(401, 'Session expired. Please log in again.')
  }

  // ── Parse response body ───────────────────────────────────────────────────
  let body
  const ct = response.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    body = await response.json()
  } else {
    body = await response.text()
  }

  if (!response.ok) {
    const message =
      (typeof body === 'object' && body?.message) ||
      (typeof body === 'object' && body?.error)   ||
      `HTTP ${response.status}`
    throw new ApiError(response.status, message, body)
  }

  return body
}

// ── Convenience methods ───────────────────────────────────────────────────────
export const get  = (path, opts = {})       => request(path, { ...opts, method: 'GET' })
export const post = (path, data, opts = {}) => request(path, { ...opts, method: 'POST', body: JSON.stringify(data) })
export const put  = (path, data, opts = {}) => request(path, { ...opts, method: 'PUT',  body: JSON.stringify(data) })
export const del  = (path, opts = {})       => request(path, { ...opts, method: 'DELETE' })

// ── Silent restore on page load ───────────────────────────────────────────────
/**
 * Called once on app startup.
 * Attempts to get a fresh access token using the HttpOnly refresh cookie.
 * Returns { user } if successful, null if no valid session exists.
 *
 * This replaces the old "read token from localStorage" pattern.
 * The browser holds the refresh cookie — we just ask the server to exchange it.
 */
export async function silentRestore() {
  try {
    const resp = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
    })

    if (!resp.ok) return null

    const body = await resp.json()
    setAccessToken(body.access_token)

    // Fetch the user profile with the new token
    const userResp = await request('/api/auth/me')
    return userResp.user ?? null

  } catch {
    return null
  }
}