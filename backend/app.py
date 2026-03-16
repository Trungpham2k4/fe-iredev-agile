# backend/app.py
# =============================================================================
# Flask application entry point.
#
# FIXES:
#   1. Added logging configuration so auth rejections print to console.
#   2. Explicit threaded=True for Flask dev server — required for WebSocket
#      + REST to work simultaneously without blocking.
#   3. use_reloader=False prevents the reloader from killing WS connections.
# =============================================================================

import logging
from flask      import Flask, jsonify
from flask_cors import CORS
from flask_sock import Sock

from config             import PORT, CORS_ORIGINS
from routes.auth_routes import auth_bp
from routes.chat_routes import chat_bp
from ws_handler         import handle_connection


# ── Logging ───────────────────────────────────────────────────────────────────
# Print DEBUG-level logs from auth_utils and ws_handler so 401 rejections
# show the exact reason in the server console.
logging.basicConfig(
    level    = logging.DEBUG,
    format   = "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt  = "%H:%M:%S",
)
# Reduce noise from werkzeug HTTP logs (keep them at WARNING)
logging.getLogger("werkzeug").setLevel(logging.WARNING)


# ── App ───────────────────────────────────────────────────────────────────────

app  = Flask(__name__)
sock = Sock(app)

CORS(app, origins=CORS_ORIGINS, supports_credentials=True)

app.register_blueprint(auth_bp, url_prefix="/api/auth")
app.register_blueprint(chat_bp, url_prefix="/api/chats")


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@sock.route("/ws")
def websocket(ws):
    handle_connection(ws)


# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


# ── Error handlers ────────────────────────────────────────────────────────────

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
╠══════════════════════════════════════════════════════════╣
║  Demo accounts                                           ║
║    demo@example.com   /  password123                     ║
║    admin@example.com  /  admin123                        ║
╚══════════════════════════════════════════════════════════╝
""")
    app.run(
        host        = "0.0.0.0",
        port        = PORT,
        debug       = True,
        use_reloader= False,   # MUST be False — reloader kills WS connections
        threaded    = True,    # MUST be True  — WS + REST need concurrent threads
    )