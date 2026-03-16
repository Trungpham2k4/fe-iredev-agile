# backend/app.py
# =============================================================================
# Flask application entry point.
#
# Serves two things on the same port:
#   1. REST API  — http://localhost:8000/api/...
#   2. WebSocket — ws://localhost:8000/ws?token=<jwt>
#
# Run:
#   python app.py
# =============================================================================

from flask      import Flask, jsonify
from flask_cors import CORS
from flask_sock import Sock

from config             import PORT, CORS_ORIGINS
from routes.auth_routes import auth_bp
from routes.chat_routes import chat_bp
from ws_handler         import handle_connection


# ── App + WebSocket setup ─────────────────────────────────────────────────────

app  = Flask(__name__)
sock = Sock(app)   # attaches the WebSocket layer to Flask

# Allow the React dev server (localhost:5173) to call this API with auth headers
CORS(app, origins=CORS_ORIGINS, supports_credentials=True)


# ── REST blueprints ───────────────────────────────────────────────────────────

app.register_blueprint(auth_bp, url_prefix="/api/auth")
app.register_blueprint(chat_bp, url_prefix="/api/chats")


# ── WebSocket endpoint ────────────────────────────────────────────────────────
# The frontend connects once at startup:  ws://localhost:8000/ws?token=<jwt>
# All AI streaming happens over this persistent connection.

@sock.route("/ws")
def websocket(ws):
    """WebSocket entry point — delegates to ws_handler.handle_connection()."""
    handle_connection(ws)


# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "message": "Server is running."}), 200


# ── Global error handlers ─────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found", "message": str(e)}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed", "message": str(e)}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error", "message": str(e)}), 500


# ── Dev server ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════════════════╗
║  Claude UI — Mock Backend (WebSocket)                   ║
║  http://localhost:{PORT}                                   ║
╠══════════════════════════════════════════════════════════╣
║  REST                                                    ║
║    POST   /api/auth/register                             ║
║    POST   /api/auth/login                                ║
║    POST   /api/auth/logout                               ║
║    GET    /api/auth/me                                   ║
║    GET    /api/chats                                     ║
║    POST   /api/chats                                     ║
║    DELETE /api/chats/<id>                                ║
║    GET    /api/chats/<id>/messages                       ║
║    POST   /api/chats/<id>/messages                       ║
╠══════════════════════════════════════════════════════════╣
║  WebSocket  ws://localhost:{PORT}/ws?token=<jwt>           ║
║    send  {{ "type": "chat_message", chatId, messageId,  ║
║             content }}  → streams tokens back            ║
║    send  {{ "type": "stop_stream",  chatId }}            ║
║    send  {{ "type": "ping" }}       → pong               ║
╠══════════════════════════════════════════════════════════╣
║  Demo accounts                                           ║
║    demo@example.com   /  password123                     ║
║    admin@example.com  /  admin123                        ║
╚══════════════════════════════════════════════════════════╝
""")
    # use_reloader=False prevents background streaming threads from being killed
    app.run(host="0.0.0.0", port=PORT, debug=True, use_reloader=False)