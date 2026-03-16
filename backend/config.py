# backend/config.py
# ─────────────────────────────────────────────────────────────────────────────
# Central configuration.  All values come from environment variables so the
# same code runs in development (with .env) and production (real env vars).
# ─────────────────────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv

# Load variables from .env file (if it exists)
load_dotenv()

# Secret used to sign + verify JWT tokens.
# IMPORTANT: change this to a long random string before deploying.
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-key-change-me")

# How many seconds a JWT token stays valid (default = 7 days)
JWT_EXPIRY_SECONDS = int(os.getenv("JWT_EXPIRY_SECONDS", 604800))

# Port the Flask dev server listens on
PORT = int(os.getenv("PORT", 8000))

# Allowed origin(s) for CORS — comma-separated string
CORS_ORIGINS = os.getenv("CORS_ORIGIN", "http://localhost:5173").split(",")