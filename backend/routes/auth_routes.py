# backend/routes/auth_routes.py
# ─────────────────────────────────────────────────────────────────────────────
# Authentication endpoints:
#
#   POST /api/auth/register   — create a new account
#   POST /api/auth/login      — sign in with email + password
#   POST /api/auth/logout     — invalidate the current token
#   GET  /api/auth/me         — return the current user's profile
# ─────────────────────────────────────────────────────────────────────────────
from flask import Blueprint, request, jsonify
import mock_db
from auth_utils import create_token, get_token_from_request, require_auth

# A Blueprint groups related routes together.
# It is registered in app.py with url_prefix="/api/auth".
auth_bp = Blueprint("auth", __name__)


# ── POST /api/auth/register ───────────────────────────────────────────────────
@auth_bp.route("/register", methods=["POST"])
def register():
    """
    Create a new user account.

    Request body (JSON):
        { "name": "Jane", "email": "jane@example.com", "password": "secret123" }

    Response 201:
        { "token": "eyJ...", "user": { "id", "name", "email", "plan" } }

    Errors:
        400  missing fields
        409  email already registered
    """
    data = request.get_json(silent=True) or {}

    # ── Validate required fields ──────────────────────────────────────────────
    name     = (data.get("name")     or "").strip()
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not name:
        return jsonify({"error": "Validation error", "message": "Name is required."}), 400
    if not email:
        return jsonify({"error": "Validation error", "message": "Email is required."}), 400
    if not password:
        return jsonify({"error": "Validation error", "message": "Password is required."}), 400
    if len(password) < 8:
        return jsonify({"error": "Validation error", "message": "Password must be at least 8 characters."}), 400

    # ── Create user (raises ValueError if email taken) ────────────────────────
    try:
        user = mock_db.create_user(name=name, email=email, password=password)
    except ValueError as e:
        return jsonify({"error": "Conflict", "message": str(e)}), 409

    # ── Issue a JWT ───────────────────────────────────────────────────────────
    token = create_token(user["id"])

    return jsonify({
        "token": token,
        "user":  mock_db.safe_user(user),
    }), 201


# ── POST /api/auth/login ──────────────────────────────────────────────────────
@auth_bp.route("/login", methods=["POST"])
def login():
    """
    Sign in with email and password.

    Request body (JSON):
        { "email": "demo@example.com", "password": "password123" }

    Response 200:
        { "token": "eyJ...", "user": { "id", "name", "email", "plan" } }

    Errors:
        400  missing fields
        401  wrong email or password
    """
    data = request.get_json(silent=True) or {}

    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return jsonify({"error": "Validation error", "message": "Email and password are required."}), 400

    # ── Look up the user ──────────────────────────────────────────────────────
    user = mock_db.find_user_by_email(email)

    # Use the same generic message for "not found" and "wrong password"
    # to avoid leaking whether an email is registered.
    if not user or not mock_db.check_password(user, password):
        return jsonify({"error": "Unauthorized", "message": "Invalid email or password."}), 401

    # ── Issue a JWT ───────────────────────────────────────────────────────────
    token = create_token(user["id"])

    return jsonify({
        "token": token,
        "user":  mock_db.safe_user(user),
    }), 200


# ── POST /api/auth/logout ─────────────────────────────────────────────────────
@auth_bp.route("/logout", methods=["POST"])
@require_auth
def logout(current_user):
    """
    Invalidate the current token.
    The token is removed from the active-tokens store so it can never be reused.

    Requires:  Authorization: Bearer <token>

    Response 200:
        { "ok": true, "message": "Logged out successfully." }
    """
    token = get_token_from_request()
    mock_db.revoke_token(token)

    return jsonify({"ok": True, "message": "Logged out successfully."}), 200


# ── GET /api/auth/me ──────────────────────────────────────────────────────────
@auth_bp.route("/me", methods=["GET"])
@require_auth
def me(current_user):
    """
    Return the currently authenticated user's profile.
    Used by the frontend on page load to validate a saved token.

    Requires:  Authorization: Bearer <token>

    Response 200:
        { "user": { "id", "name", "email", "plan" } }
    """
    return jsonify({"user": current_user}), 200