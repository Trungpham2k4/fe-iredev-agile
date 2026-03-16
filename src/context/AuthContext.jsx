// src/context/AuthContext.jsx
// =============================================================================
// Authentication state for the whole app.
//
// Responsibilities:
//   - Restore session from localStorage on page load
//   - Open the WebSocket connection once the user is authenticated
//   - Close the WebSocket on logout
//   - Expose login(), logout(), user, isAuthenticated to every component
// =============================================================================
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  getAuthToken,
} from '../services/apiClient'

import {
  login as apiLogin,
  logout as apiLogout,
} from '../services/chatService'
import { wsService } from '../services/websocketService'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(null)
  const [initialising, setInitialising] = useState(true)  // page-load check
  const [authLoading,  setAuthLoading]  = useState(false)
  const [authError,    setAuthError]    = useState(null)

  const isAuthenticated = user !== null

  // ── On mount: restore session from localStorage ───────────────────────────
  useEffect(() => {
    const token     = getAuthToken()
    const savedUser = localStorage.getItem('auth_user')

    if (token && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser)
        setUser(parsedUser)
        // Open the WebSocket immediately — token is already available
        wsService.connect(token)
      } catch {
        // Corrupt localStorage — clear it
        localStorage.removeItem('auth_user')
        localStorage.removeItem('auth_token')
      }
    }

    setInitialising(false)
  }, [])

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (credentials) => {
    setAuthError(null)
    setAuthLoading(true)

    try {
      const result = await apiLogin(credentials)  // saves token to localStorage

      setUser(result.user)
      localStorage.setItem('auth_user', JSON.stringify(result.user))

      // Open the WebSocket NOW — we have a valid token from this login response
      wsService.connect(result.token)

      return result
    } catch (err) {
      const msg = err.status === 401
        ? 'Invalid email or password.'
        : err.message || 'Login failed. Please try again.'
      setAuthError(msg)
      throw err
    } finally {
      setAuthLoading(false)
    }
  }, [])

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    setAuthLoading(true)

    // Close the WebSocket BEFORE clearing the token so the close frame is
    // sent while the connection is still authenticated
    wsService.close()

    try {
      await apiLogout()
    } catch {
      // Even if the server call fails, clear local state
    } finally {
      setUser(null)
      localStorage.removeItem('auth_user')
      setAuthLoading(false)
    }
  }, [])

  const clearAuthError = useCallback(() => setAuthError(null), [])

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      initialising,
      authLoading,
      authError,
      login,
      logout,
      clearAuthError,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}