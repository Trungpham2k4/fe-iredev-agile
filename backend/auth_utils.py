# backend/auth_utils.py
# =============================================================================
# JWT helpers and the @require_auth decorator.
#
# verify_token() is the single source of truth for authentication.
# It is used by both REST routes (@require_auth) and the WebSocket handshake.
#
# Design: Trust JWT signature first, use TOKENS dict only for logout revocation.
# This works correctly after server restarts (TOKENS is empty, JWT is still valid).
# =============================================================================
import jwt
import datetime
import logging
from functools import wraps
from flask import request, jsonify
from config import JWT_SECRET, JWT_EXPIRY_SECONDS
import mock_db

log = logging.getLogger(__name__)


def create_token(user_id: str) -> str:
    """Create a signed JWT and register it in TOKENS."""
    now     = datetime.datetime.utcnow()
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + datetime.timedelta(seconds=JWT_EXPIRY_SECONDS),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    mock_db.register_token(token, user_id)
    log.debug(f"[auth] Token created for user={user_id}")
    return token


def decode_token(token: str) -> dict | None:
    """
    Verify JWT signature + expiry.
    Returns the payload dict on success, None on failure.
    """
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        log.debug("[auth] Token rejected: expired")
        return None
    except jwt.InvalidTokenError as e:
        log.debug(f"[auth] Token rejected: invalid — {e}")
        return None


def get_token_from_request() -> str | None:
    """Extract the Bearer token from the Authorization header."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[len("Bearer "):]
    return None


def verify_token(token: str) -> str | None:
    """
    Verify a token and return its user_id, or None if invalid.

    Rules (applied in order):
      1. Token must be a non-empty string.
      2. JWT signature and expiry must be valid.
      3. JWT payload must contain a 'sub' (user_id).
      4. If TOKENS dict is non-empty (server hasn't restarted), the token
         must still be present (i.e. not explicitly revoked via logout).
         If TOKENS is empty we skip this check — a restart clears TOKENS
         but doesn't invalidate existing JWTs.
      5. The user referenced by sub must exist in USERS.

    Used by both REST (@require_auth) and WebSocket handshake.
    """
    if not token:
        log.debug("[auth] verify_token: empty token")
        return None

    # ── Rule 2: JWT signature + expiry ───────────────────────────────────────
    payload = decode_token(token)
    if not payload:
        return None   # decode_token already logs the reason

    # ── Rule 3: extract user_id from payload ──────────────────────────────────
    user_id = payload.get("sub")
    if not user_id:
        log.debug("[auth] verify_token: payload has no 'sub' claim")
        return None

    # ── Rule 4: revocation check ──────────────────────────────────────────────
    # Only check TOKENS if it has entries.
    # An empty TOKENS means the server just restarted — we trust the JWT alone.
    if mock_db.TOKENS:
        stored_uid = mock_db.get_user_id_for_token(token)
        if stored_uid is None:
            log.debug(f"[auth] verify_token: token revoked for user={user_id}")
            return None
        if stored_uid != user_id:
            log.debug(f"[auth] verify_token: token user mismatch stored={stored_uid} claimed={user_id}")
            return None

    # ── Rule 5: user must exist ───────────────────────────────────────────────
    if not mock_db.find_user_by_id(user_id):
        log.debug(f"[auth] verify_token: user not found user_id={user_id}")
        return None

    log.debug(f"[auth] verify_token: OK user={user_id}")
    return user_id


def require_auth(f):
    """
    Decorator that protects a route.
    Extracts the Bearer token, calls verify_token(), injects current_user.
    Returns 401 with a clear message if anything fails.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = get_token_from_request()

        if not token:
            log.warning("[auth] require_auth: no Authorization header")
            return jsonify({
                "error":   "Missing token",
                "message": "Authorization: Bearer <token> header is required.",
            }), 401

        user_id = verify_token(token)
        if not user_id:
            log.warning(f"[auth] require_auth: invalid/revoked token (first 20 chars: {token[:20]})")
            return jsonify({
                "error":   "Invalid token",
                "message": "Token is expired, malformed, or has been revoked.",
            }), 401

        user = mock_db.find_user_by_id(user_id)
        if not user:
            log.warning(f"[auth] require_auth: user not found user_id={user_id}")
            return jsonify({"error": "User not found"}), 401

        return f(mock_db.safe_user(user), *args, **kwargs)

    return wrapper


def get_user_id_for_token_ws(token: str) -> str | None:
    """Verify a token for a WebSocket connection (same logic as REST)."""
    return verify_token(token)