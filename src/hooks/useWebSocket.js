// src/hooks/useWebSocket.js
// =============================================================================
// React hook that manages the WebSocket lifecycle.
//
// IMPORTANT TIMING: The WS connection must be opened AFTER the user logs in
// so a valid token is available. This hook does NOT call connect() itself —
// instead the caller (useChat / AuthContext) calls wsService.connect(token)
// at the right moment (after login succeeds).
//
// This hook's only job is to:
//   1. Register all event handlers on mount (using refs to avoid stale closures)
//   2. Unregister them on unmount
//
// Usage in useChat.js:
//   useWebSocket({ onToken, onDone, onError, onArtifact, onConnected })
// =============================================================================

import { useEffect, useRef } from 'react'
import { wsService }         from '../services/websocketService'

export function useWebSocket({
  onToken,
  onDone,
  onError,
  onArtifact,
  onConnected,
  onDisconnected,
}) {
  // Keep refs to callbacks so handlers registered once always call the
  // latest version — avoids stale closure bugs without re-registering.
  const refs = {
    onToken:        useRef(onToken),
    onDone:         useRef(onDone),
    onError:        useRef(onError),
    onArtifact:     useRef(onArtifact),
    onConnected:    useRef(onConnected),
    onDisconnected: useRef(onDisconnected),
  }

  // Sync refs on every render
  refs.onToken.current        = onToken
  refs.onDone.current         = onDone
  refs.onError.current        = onError
  refs.onArtifact.current     = onArtifact
  refs.onConnected.current    = onConnected
  refs.onDisconnected.current = onDisconnected

  // Register all handlers once on mount, unregister on unmount
  useEffect(() => {
    const off = [
      wsService.on('token',         (m) => refs.onToken.current?.(m)),
      wsService.on('done',          (m) => refs.onDone.current?.(m)),
      wsService.on('error',         (m) => refs.onError.current?.(m)),
      wsService.on('artifact',      (m) => refs.onArtifact.current?.(m)),
      wsService.on('connected',     (m) => refs.onConnected.current?.(m)),
      wsService.on('_connected',    (m) => refs.onConnected.current?.(m)),
      wsService.on('_disconnected', (m) => refs.onDisconnected.current?.(m)),
    ]
    return () => off.forEach((fn) => fn())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}