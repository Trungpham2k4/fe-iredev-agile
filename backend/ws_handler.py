# backend/ws_handler.py
# =============================================================================
# WebSocket handler — one persistent connection per user session.
#
# Protocol (Client → Server):
#   { "type": "ping" }
#   { "type": "chat_message", "chatId": "c1", "messageId": "ph_x", "content": "..." }
#   { "type": "stop_stream",  "chatId": "c1" }
#
# Protocol (Server → Client):
#   { "type": "pong" }
#   { "type": "connected", "userId": "u001" }
#   { "type": "token",    "chatId": "c1", "messageId": "ph_x", "token": "Hello " }
#   { "type": "done",     "chatId": "c1", "messageId": "ph_x" }
#   { "type": "artifact", "chatId": "c1", "messageId": "ph_x", "artifact": {...} }
#   { "type": "error",    "chatId": "c1", "messageId": "ph_x", "error": "..." }
# =============================================================================

import json
import time
import re
import threading

import mock_db
from ai_engine  import generate_response, stream_tokens
from auth_utils import get_user_id_for_token_ws


# =============================================================================
# Per-connection stop-flag registry
# Lets the main loop signal streaming threads to stop.
# =============================================================================

# { ws_id(id(ws)) → { chat_id → threading.Event } }
_stop_flags: dict = {}
_flags_lock = threading.Lock()


def _get_stop_flag(ws_id: int, chat_id: str) -> threading.Event:
    """Return (or create) a stop flag for a specific ws + chat pair."""
    with _flags_lock:
        if ws_id not in _stop_flags:
            _stop_flags[ws_id] = {}
        if chat_id not in _stop_flags[ws_id]:
            _stop_flags[ws_id][chat_id] = threading.Event()
        return _stop_flags[ws_id][chat_id]


def _reset_stop_flag(ws_id: int, chat_id: str):
    """Clear a stop flag so the next stream can run."""
    with _flags_lock:
        if ws_id in _stop_flags and chat_id in _stop_flags[ws_id]:
            _stop_flags[ws_id][chat_id].clear()


def _set_stop_flag(ws_id: int, chat_id: str):
    """Signal a running stream thread to stop after the next token."""
    with _flags_lock:
        if ws_id in _stop_flags and chat_id in _stop_flags[ws_id]:
            _stop_flags[ws_id][chat_id].set()


def _cleanup_flags(ws_id: int):
    """Remove all stop flags for a closed connection."""
    with _flags_lock:
        _stop_flags.pop(ws_id, None)


# =============================================================================
# Main entry point
# =============================================================================

def handle_connection(ws):
    """
    Called by Flask-Sock for every new WebSocket connection.

    Authenticates the token from ?token=<jwt>, then enters the
    receive-loop dispatching incoming frames until the client disconnects.
    """
    from flask import request as flask_req

    # ── 1. Authenticate ───────────────────────────────────────────────────────
    token   = flask_req.args.get("token", "")
    user_id = get_user_id_for_token_ws(token)

    if not user_id:
        # Send the error then close — the client will see an auth error frame
        try:
            _send(ws, {
                "type":  "error",
                "error": "Unauthorized: invalid or missing token",
            })
        except Exception:
            pass
        return   # returning from handle_connection closes the socket

    ws_id = id(ws)
    print(f"[WS] Connected   user={user_id}  ws={ws_id}")

    # Tell the client authentication succeeded
    try:
        _send(ws, {"type": "connected", "userId": user_id})
    except Exception:
        return

    # ── 2. Message loop ───────────────────────────────────────────────────────
    try:
        while True:
            raw = ws.receive()   # blocks until a frame arrives
            if raw is None:
                break            # client closed the connection

            _dispatch(ws, ws_id, user_id, raw)

    except Exception as exc:
        print(f"[WS] Exception   user={user_id}  err={exc}")
    finally:
        _cleanup_flags(ws_id)
        print(f"[WS] Disconnected user={user_id}  ws={ws_id}")


# =============================================================================
# Frame dispatcher
# =============================================================================

def _dispatch(ws, ws_id: int, user_id: str, raw: str):
    """Parse one JSON frame and route it to the correct handler."""
    try:
        frame = json.loads(raw)
    except json.JSONDecodeError:
        print(f"[WS] Bad JSON from user={user_id}: {raw!r}")
        return

    ftype = frame.get("type", "")

    if ftype == "ping":
        # Simple keep-alive — reply immediately
        _send(ws, {"type": "pong"})

    elif ftype == "chat_message":
        chat_id    = frame.get("chatId", "").strip()
        message_id = frame.get("messageId", "").strip()  # frontend placeholder ID
        content    = frame.get("content",   "").strip()

        if not chat_id or not content:
            _send(ws, {"type": "error",
                       "error": "chat_message requires chatId and content"})
            return

        # Reset any leftover stop flag from a previous stream on this chat
        _reset_stop_flag(ws_id, chat_id)

        # Stream the AI reply in a background daemon thread so the
        # receive loop can still process stop_stream and ping frames.
        t = threading.Thread(
            target  = _stream_reply,
            args    = (ws, ws_id, user_id, chat_id, message_id, content),
            daemon  = True,
        )
        t.start()

    elif ftype == "stop_stream":
        chat_id = frame.get("chatId", "").strip()
        if chat_id:
            _set_stop_flag(ws_id, chat_id)
            print(f"[WS] Stop signal  chat={chat_id}  user={user_id}")

    else:
        print(f"[WS] Unknown frame type='{ftype}'  user={user_id}")


# =============================================================================
# AI streaming — runs in a background thread per chat_message
# =============================================================================

def _stream_reply(ws, ws_id: int, user_id: str,
                  chat_id: str, message_id: str, content: str):
    """
    Generate the AI reply and push each token to the client over ws.send().

    - Runs in a daemon thread → doesn't block the WS message loop.
    - Checks the stop flag after every token so the client can cancel.
    - Persists the completed assistant message to mock_db when done.
    """

    # ── Guard: verify the chat belongs to this user ───────────────────────────
    chat = mock_db.get_chat(chat_id)
    if not chat or chat["userId"] != user_id:
        _safe_send(ws, {
            "type":      "error",
            "chatId":    chat_id,
            "messageId": message_id,
            "error":     "Chat not found or access denied",
        })
        return

    print(f"[WS] Streaming   chat={chat_id}  msgId={message_id}")

    # ── Generate the full reply ───────────────────────────────────────────────
    # generate_response() picks a canned reply based on keywords.
    # stream_tokens()     splits the text into word-level chunks with delays.
    try:
        full_reply = generate_response(content)
    except Exception as exc:
        _safe_send(ws, {
            "type":      "error",
            "chatId":    chat_id,
            "messageId": message_id,
            "error":     str(exc),
        })
        return

    stop_flag   = _get_stop_flag(ws_id, chat_id)
    accumulated = ""

    # ── Stream tokens one by one ──────────────────────────────────────────────
    for token, delay in stream_tokens(full_reply):

        # Did the client click "Stop generating"?
        if stop_flag.is_set():
            print(f"[WS] Stopped by client  chat={chat_id}")
            break

        accumulated += token

        # Send the token — if the socket closed mid-stream, bail out
        ok = _safe_send(ws, {
            "type":      "token",
            "chatId":    chat_id,
            "messageId": message_id,
            "token":     token,
        })
        if not ok:
            print(f"[WS] Socket closed mid-stream  chat={chat_id}")
            return

        time.sleep(delay)   # pacing (~25 ms per word, longer after punctuation)

    # ── Signal stream complete ────────────────────────────────────────────────
    _safe_send(ws, {"type": "done", "chatId": chat_id, "messageId": message_id})

    # ── Attach artifact if the reply contained a code block ───────────────────
    artifact = _extract_artifact(message_id, full_reply)
    if artifact:
        _safe_send(ws, {
            "type":      "artifact",
            "chatId":    chat_id,
            "messageId": message_id,
            "artifact":  artifact,
        })

    # ── Persist the complete assistant message ────────────────────────────────
    if accumulated.strip():
        mock_db.add_message(chat_id=chat_id, role="assistant", content=accumulated)
        print(f"[WS] Saved reply  chat={chat_id}  chars={len(accumulated)}")

    print(f"[WS] Stream done  chat={chat_id}  msgId={message_id}")


# =============================================================================
# Helpers
# =============================================================================

def _send(ws, payload: dict):
    """Serialise payload to JSON and send. Raises on failure."""
    ws.send(json.dumps(payload))


def _safe_send(ws, payload: dict) -> bool:
    """
    Send a frame without raising.
    Returns True on success, False if the socket is closed.
    Used inside streaming threads where a closed socket is expected.
    """
    try:
        ws.send(json.dumps(payload))
        return True
    except Exception:
        return False


def _extract_artifact(message_id: str, text: str) -> dict | None:
    """
    Scan the AI reply for the first fenced code block.
    Returns an artifact dict if found, None otherwise.
    """
    match = re.search(r'```(\w*)\n([\s\S]+?)```', text)
    if not match:
        return None

    language = match.group(1).strip() or "code"
    code     = match.group(2).strip()

    type_map = {
        "jsx": "react", "tsx": "react",
        "html": "html",
        "js": "code", "javascript": "code",
        "py": "code", "python": "code",
        "svg": "svg",
    }

    return {
        "id":       f"art_{message_id}",
        "type":     type_map.get(language.lower(), "code"),
        "title":    f"{language.upper()} snippet" if language else "Code snippet",
        "language": language,
        "content":  code,
    }