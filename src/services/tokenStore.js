// src/services/tokenStore.js
// =============================================================================
// In-memory access token store — the ONLY place the access token lives.
//
// Never written to localStorage, sessionStorage, or any cookie.
// Lost on page refresh — the silent-refresh mechanism in apiClient.js
// calls POST /api/auth/refresh on startup to restore it from the HttpOnly
// cookie that the browser holds automatically.
//
// All other modules import from here — one source of truth.
// =============================================================================

let _accessToken = null

export const setAccessToken  = (token) => { _accessToken = token }
export const clearAccessToken = ()     => { _accessToken = null  }
export const getAccessToken  = ()      => _accessToken
export const hasAccessToken  = ()      => _accessToken !== null