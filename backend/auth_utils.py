# backend/auth_utils.py
# =============================================================================
# JWT helpers and the @require_auth decorator.
# =============================================================================
import jwt
import datetime
from functools import wraps
from flask import request, jsonify
from config import JWT_SECRET, JWT_EXPIRY_SECONDS
import mock_db


def create_token(user_id: str) -> str:
    """
    Create a signed JWT for the given user_id and register it in TOKENS.
    """
    now = datetime.datetime.now()
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + datetime.timedelta(seconds=JWT_EXPIRY_SECONDS),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    mock_db.register_token(token, user_id)
    return token


def decode_token(token: str) -> dict | None:
    """
    Verify and decode a JWT.
    Returns the payload dict on success, None if invalid or expired.
    """
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def get_token_from_request() -> str | None:
    """Extract the Bearer token from the Authorization header."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[len("Bearer "):]
    return None


def verify_token(token: str) -> str | None:
    """
    Verify a token string and return the user_id it belongs to.

    Strategy:
      1. Decode and verify the JWT signature + expiry first.
         This works even after a server restart (no TOKENS lookup needed).
      2. Then check the TOKENS dict to catch explicitly revoked tokens
         (e.g. user logged out on another tab/device).

    Returns the user_id string, or None if invalid/expired/revoked.

    This function is used by BOTH the REST require_auth decorator and
    the WebSocket handshake so the logic is in one place.
    """
    if not token:
        return None

    # Step 1: verify JWT signature and expiry
    payload = decode_token(token)
    if not payload:
        return None   # expired or tampered

    user_id = payload.get("sub")
    if not user_id:
        return None

    # Step 2: check for explicit revocation (logout)
    # TOKENS only contains tokens issued during THIS server process.
    # If TOKENS is empty (server just restarted), we skip the revocation
    # check and trust the JWT signature alone.
    if mock_db.TOKENS:
        # The revocation store has entries — check that this token is still valid
        if mock_db.get_user_id_for_token(token) is None:
            return None   # token was explicitly revoked (user logged out)

    # Step 3: confirm the user still exists
    if not mock_db.find_user_by_id(user_id):
        return None

    return user_id


def require_auth(f):
    """
    Route decorator — injects current_user as the first argument.
    Returns 401 if the token is missing, invalid, or revoked.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = get_token_from_request()
        if not token:
            return jsonify({"error": "Missing token",
                            "message": "Authorization header required."}), 401

        user_id = verify_token(token)
        if not user_id:
            return jsonify({"error": "Invalid token",
                            "message": "Token is expired, malformed, or revoked."}), 401

        user = mock_db.find_user_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 401

        return f(mock_db.safe_user(user), *args, **kwargs)

    return wrapper


def get_user_id_for_token_ws(token: str) -> str | None:
    """
    Verify a token for a WebSocket connection.
    Uses the same verify_token() logic as REST routes.
    """
    return verify_token(token)