# backend/ws_handler.py
# =============================================================================
# WebSocket handler.
#
# KEY FIX: The WS reconnect loop in the logs was caused by an exception
# being thrown inside handle_connection() before ws.receive() was called.
# The _safe_send() for the 'connected' frame was crashing because
# _state[ws_id]['send_lock'] lookup race — now simplified.
#
# Also fixed: ws.receive() can raise ConnectionClosed (simple_websocket) or
# ConnectionClosedError (websockets lib). Both are now caught explicitly.
# =============================================================================

import json
import time
import re
import threading
import uuid
import logging

import mock_db
from ai_engine  import generate_response, generate_revision, stream_tokens
from auth_utils import get_user_id_for_token_ws

log = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
MAX_REVISIONS    = 5
FEEDBACK_TIMEOUT = 300   # seconds


# =============================================================================
# Per-connection state
# Keyed by ws_id = id(ws).
#
# Simplified from previous version: each ws gets a simple dict with
# stop flags, feedback events, and ONE lock for all sends.
# =============================================================================

_state:      dict          = {}
_state_lock: threading.Lock = threading.Lock()


def _init(ws_id: int, lock: threading.Lock):
    with _state_lock:
        _state[ws_id] = {
            "lock":            lock,           # one lock per connection, reused everywhere
            "stop":            {},             # { chat_id → threading.Event }
            "fb_events":       {},             # { artifact_id → threading.Event }
            "fb_data":         {},             # { artifact_id → { action, comment } }
        }

def _cleanup(ws_id: int):
    with _state_lock:
        _state.pop(ws_id, None)

def _get(ws_id: int) -> dict | None:
    return _state.get(ws_id)


# ── Stop flags ─────────────────────────────────────────────────────────────────

def _stop_flag(ws_id, chat_id) -> threading.Event:
    s = _get(ws_id)
    if not s: return threading.Event()
    with _state_lock:
        if chat_id not in s["stop"]:
            s["stop"][chat_id] = threading.Event()
        return s["stop"][chat_id]

def _reset_stop(ws_id, chat_id):
    s = _get(ws_id)
    if s:
        with _state_lock:
            s["stop"].pop(chat_id, None)   # remove so next call to _stop_flag creates fresh

def _set_stop(ws_id, chat_id):
    s = _get(ws_id)
    if s:
        with _state_lock:
            if chat_id in s["stop"]:
                s["stop"][chat_id].set()


# ── Feedback events ────────────────────────────────────────────────────────────

def _create_fb_event(ws_id, artifact_id) -> threading.Event:
    s = _get(ws_id)
    if not s: return threading.Event()
    ev = threading.Event()
    with _state_lock:
        s["fb_events"][artifact_id] = ev
        s["fb_data"].pop(artifact_id, None)
    return ev

def _deliver_fb(ws_id, artifact_id, action, comment):
    s = _get(ws_id)
    if not s: return
    with _state_lock:
        s["fb_data"][artifact_id] = {"action": action, "comment": comment}
        ev = s["fb_events"].get(artifact_id)
    if ev:
        ev.set()

def _get_fb(ws_id, artifact_id) -> dict | None:
    s = _get(ws_id)
    if not s: return None
    with _state_lock:
        return s["fb_data"].get(artifact_id)

def _remove_fb(ws_id, artifact_id):
    s = _get(ws_id)
    if s:
        with _state_lock:
            s["fb_events"].pop(artifact_id, None)
            s["fb_data"].pop(artifact_id, None)


# =============================================================================
# Thread-safe send
# Uses the per-connection lock created in handle_connection.
# =============================================================================

def _send(ws, lock: threading.Lock, payload: dict) -> bool:
    """
    Send a JSON frame thread-safely.
    Returns True on success, False if the socket is closed or any error.
    """
    try:
        with lock:
            ws.send(json.dumps(payload))
        return True
    except Exception as exc:
        log.debug(f"[WS] send failed: {exc}")
        return False


# =============================================================================
# Main entry point
# =============================================================================

def handle_connection(ws):
    """
    Called by Flask-Sock for every new WebSocket connection.

    IMPORTANT: We create the send lock HERE and pass it explicitly to every
    function that needs to send. This avoids the timing issue where _state
    might not be initialised yet when _safe_send is first called.
    """
    from flask import request as flask_req

    # ── 1. Authenticate ───────────────────────────────────────────────────────
    token   = flask_req.args.get("token", "")
    user_id = get_user_id_for_token_ws(token)

    if not user_id:
        log.warning(f"[WS] Rejected: invalid/missing token (first 20: {token[:20]!r})")
        try:
            ws.send(json.dumps({"type": "error", "error": "Unauthorized"}))
        except Exception:
            pass
        return

    # ── 2. Create the send lock and register state ────────────────────────────
    # The lock is created here and passed explicitly — no global state lookup.
    lock  = threading.Lock()
    ws_id = id(ws)
    _init(ws_id, lock)

    log.info(f"[WS] Connected  user={user_id}  ws={ws_id}")

    # Confirm connection to the client
    ok = _send(ws, lock, {"type": "connected", "userId": user_id})
    if not ok:
        log.warning(f"[WS] Could not send 'connected' frame, closing  ws={ws_id}")
        _cleanup(ws_id)
        return

    # ── 3. Message loop ───────────────────────────────────────────────────────
    try:
        while True:
            try:
                raw = ws.receive()
            except Exception as exc:
                # Connection closed by client or network error
                log.info(f"[WS] receive() raised: {exc}  ws={ws_id}")
                break

            if raw is None:
                log.info(f"[WS] receive() returned None (client closed)  ws={ws_id}")
                break

            _dispatch(ws, lock, ws_id, user_id, raw)

    except Exception as exc:
        log.error(f"[WS] Unhandled exception  user={user_id}  err={exc}", exc_info=True)
    finally:
        _cleanup(ws_id)
        log.info(f"[WS] Disconnected  user={user_id}  ws={ws_id}")


# =============================================================================
# Frame dispatcher
# =============================================================================

def _dispatch(ws, lock, ws_id, user_id, raw):
    try:
        frame = json.loads(raw)
    except json.JSONDecodeError:
        log.warning(f"[WS] Bad JSON from user={user_id}: {raw!r}")
        return

    ftype = frame.get("type", "")
    log.debug(f"[WS] → {ftype}  user={user_id}")

    if ftype == "ping":
        _send(ws, lock, {"type": "pong"})

    elif ftype == "chat_message":
        chat_id    = frame.get("chatId",    "").strip()
        message_id = frame.get("messageId", "").strip()
        content    = frame.get("content",   "").strip()

        if not chat_id or not content:
            _send(ws, lock, {"type": "error",
                             "error": "chat_message requires chatId and content"})
            return

        _reset_stop(ws_id, chat_id)

        threading.Thread(
            target=_stream_reply,
            args=(ws, lock, ws_id, user_id, chat_id, message_id, content),
            daemon=True,
        ).start()

    elif ftype == "stop_stream":
        chat_id = frame.get("chatId", "").strip()
        if chat_id:
            _set_stop(ws_id, chat_id)
            log.info(f"[WS] Stop  chat={chat_id}  user={user_id}")

    elif ftype == "artifact_feedback":
        chat_id     = frame.get("chatId",     "").strip()
        artifact_id = frame.get("artifactId", "").strip()
        action      = frame.get("action",     "").strip()
        comment     = frame.get("comment",    "").strip()

        if not artifact_id or action not in ("accept", "revise"):
            _send(ws, lock, {"type": "error",
                             "error": "artifact_feedback requires artifactId and action"})
            return

        log.info(f"[WS] Feedback  artifact={artifact_id}  action={action}")
        _deliver_fb(ws_id, artifact_id, action, comment)

    else:
        log.debug(f"[WS] Unknown frame type='{ftype}'")


# =============================================================================
# AI streaming with human-in-the-loop artifact review
# =============================================================================

def _stream_reply(ws, lock, ws_id, user_id, chat_id, message_id, content):
    """Stream AI reply tokens. If a code block is present, enter feedback loop."""

    chat = mock_db.get_chat(chat_id)
    if not chat or chat["userId"] != user_id:
        _send(ws, lock, {"type": "error", "chatId": chat_id,
                         "messageId": message_id,
                         "error": "Chat not found or access denied"})
        return

    log.info(f"[WS] Streaming  chat={chat_id}  msgId={message_id}")

    # Generate and stream initial reply
    try:
        full_reply = generate_response(content)
    except Exception as exc:
        _send(ws, lock, {"type": "error", "chatId": chat_id,
                         "messageId": message_id, "error": str(exc)})
        return

    stop   = _stop_flag(ws_id, chat_id)
    accum  = ""

    for token, delay in stream_tokens(full_reply):
        if stop.is_set():
            log.info(f"[WS] Stopped  chat={chat_id}")
            break
        accum += token
        ok = _send(ws, lock, {"type": "token", "chatId": chat_id,
                              "messageId": message_id, "token": token})
        if not ok:
            return
        time.sleep(delay)

    _send(ws, lock, {"type": "done", "chatId": chat_id, "messageId": message_id})

    if accum.strip():
        mock_db.add_message(chat_id=chat_id, role="assistant", content=accum)

    # ── Artifact feedback loop ─────────────────────────────────────────────────
    artifact = _extract_artifact(message_id, full_reply)
    if not artifact:
        log.info(f"[WS] Done (no artifact)  chat={chat_id}")
        return

    current_content = artifact["content"]

    for iteration in range(1, MAX_REVISIONS + 1):
        art_id = f"art_{message_id}_v{iteration}"
        artifact.update({"id": art_id, "content": current_content, "iteration": iteration})

        fb_event = _create_fb_event(ws_id, art_id)

        frame_type = "artifact" if iteration == 1 else "artifact_revised"
        _send(ws, lock, {
            "type": frame_type, "chatId": chat_id, "messageId": message_id,
            "artifact": artifact, "awaitingFeedback": True,
            "iteration": iteration, "maxIterations": MAX_REVISIONS,
        })

        log.info(f"[WS] Awaiting feedback  artifact={art_id}  iter={iteration}/{MAX_REVISIONS}")

        received = fb_event.wait(timeout=FEEDBACK_TIMEOUT)

        if not received:
            mock_db.save_artifact(chat_id, message_id, artifact)
            _send(ws, lock, {"type": "artifact_timeout", "chatId": chat_id,
                             "messageId": message_id, "artifactId": art_id})
            return

        if stop.is_set():
            return

        fb     = _get_fb(ws_id, art_id)
        _remove_fb(ws_id, art_id)
        action = (fb or {}).get("action", "accept")
        comment= (fb or {}).get("comment", "")

        if action == "accept":
            log.info(f"[WS] Accepted  artifact={art_id}")
            mock_db.save_artifact(chat_id, message_id, artifact)
            _send(ws, lock, {"type": "artifact_accepted", "chatId": chat_id,
                             "messageId": message_id, "artifactId": art_id})
            return

        # Revise
        log.info(f"[WS] Revising  comment={comment!r}  iter={iteration}")
        try:
            current_content = generate_revision(current_content, comment)
        except Exception as exc:
            _send(ws, lock, {"type": "error", "chatId": chat_id,
                             "messageId": message_id, "error": str(exc)})
            return

        rev_msg_id = f"{message_id}_rev{iteration}"
        rev_text   = f"Revising based on your feedback: _{comment}_\n\n"

        _send(ws, lock, {"type": "revision_start", "chatId": chat_id,
                         "messageId": rev_msg_id, "comment": comment, "iteration": iteration})

        rev_accum = ""
        for token, delay in stream_tokens(rev_text):
            if stop.is_set(): return
            rev_accum += token
            ok = _send(ws, lock, {"type": "token", "chatId": chat_id,
                                  "messageId": rev_msg_id, "token": token})
            if not ok: return
            time.sleep(delay)

        _send(ws, lock, {"type": "done", "chatId": chat_id, "messageId": rev_msg_id})
        if rev_accum.strip():
            mock_db.add_message(chat_id=chat_id, role="assistant", content=rev_accum)

    # Max revisions reached
    artifact["content"] = current_content
    mock_db.save_artifact(chat_id, message_id, artifact)
    _send(ws, lock, {"type": "artifact_accepted", "chatId": chat_id,
                     "messageId": message_id, "artifactId": artifact["id"],
                     "autoAccepted": True})


# =============================================================================
# Helpers
# =============================================================================

def _extract_artifact(message_id, text):
    match = re.search(r'```(\w*)\n([\s\S]+?)```', text)
    if not match:
        return None
    language = match.group(1).strip() or "code"
    code     = match.group(2).strip()
    type_map = {
        "jsx":"react","tsx":"react","html":"html",
        "js":"code","javascript":"code","py":"code","python":"code","svg":"svg",
    }
    return {
        "id":       f"art_{message_id}_v1",
        "type":     type_map.get(language.lower(), "code"),
        "title":    f"{language.upper()} snippet" if language else "Code snippet",
        "language": language,
        "content":  code,
        "iteration":1,
    }