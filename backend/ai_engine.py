# backend/ai_engine.py
# =============================================================================
# Mock AI response engine.
#
# In a real app this module would call the Anthropic / OpenAI API.
# Here it picks a canned response based on keywords in the user's message,
# then yields the reply word-by-word so the WebSocket handler can stream
# each chunk to the browser exactly like a real LLM would.
#
# Public API:
#   generate_response(user_message)  →  full reply string
#   stream_tokens(text)              →  generator of (token, delay_seconds)
# =============================================================================

import re
import time


# =============================================================================
# Response bank
# Keyed by a short label; matched by keyword scanning in pick_response().
# =============================================================================

_RESPONSES: dict[str, str] = {

    # ── Greeting ──────────────────────────────────────────────────────────────
    "greeting": """\
Hello! I'm Claude, an AI assistant made by Anthropic. I'm here to help you \
with writing, coding, analysis, research, creative work, and much more.

What would you like to work on today?\
""",

    # ── React / frontend ─────────────────────────────────────────────────────
    "react": """\
Here's a clean, reusable React custom hook pattern:

```jsx
// hooks/useLocalStorage.js
import { useState, useEffect } from 'react'

export function useLocalStorage(key, initialValue) {
  // Lazy initialiser — only runs once on mount
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? JSON.parse(stored) : initialValue
    } catch {
      return initialValue
    }
  })

  // Keep localStorage in sync whenever value changes
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])

  return [value, setValue]
}
```

**Usage — exactly like useState:**
```jsx
const [theme, setTheme] = useLocalStorage('theme', 'light')
```

**Why this works well:**
1. **Lazy initialisation** — the callback in `useState` only runs once, not on every render
2. **Automatic sync** — `useEffect` keeps localStorage up to date
3. **Error safety** — the `try/catch` guards against corrupted stored JSON\
""",

    # ── Python ────────────────────────────────────────────────────────────────
    "python": """\
Here's a solid pandas data-cleaning workflow:

```python
import pandas as pd

# 1. Load
df = pd.read_csv('data.csv')
print(df.shape)      # (rows, cols)
print(df.dtypes)     # column types

# 2. Clean
df = df.dropna(subset=['name', 'price'])   # drop rows with missing key fields
df['price'] = pd.to_numeric(df['price'], errors='coerce')  # coerce bad values to NaN
df = df.dropna(subset=['price'])           # drop rows where price couldn't be parsed

# 3. Transform
df['price_usd'] = (df['price'] * 1.08).round(2)   # add 8% tax

# 4. Aggregate
summary = (
    df
    .groupby('category')
    .agg(
        count     = ('name',      'count'),
        avg_price = ('price_usd', 'mean'),
        total     = ('price_usd', 'sum'),
    )
    .round(2)
    .reset_index()
    .sort_values('total', ascending=False)
)
print(summary)
```

**Key techniques:**
- `dropna(subset=[...])` — only drops rows where *specific* columns are null
- `pd.to_numeric(errors='coerce')` — converts bad strings to `NaN` instead of crashing
- Named aggregation syntax (`col = ('field', 'func')`) is cleaner than a dict\
""",

    # ── JavaScript / Node ─────────────────────────────────────────────────────
    "javascript": """\
Here's a robust async utility with automatic retries:

```javascript
// utils/fetchWithRetry.js

/**
 * Fetch JSON with exponential back-off on failure.
 * @param {string} url
 * @param {RequestInit} options  — standard fetch options
 * @param {number}      retries  — max attempts (default 3)
 */
export async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      })

      // 4xx errors won't succeed on retry — throw immediately
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`Client error ${res.status}`)
      }

      if (!res.ok) throw new Error(`Server error ${res.status}`)

      return await res.json()

    } catch (err) {
      if (attempt === retries) throw err

      // Exponential back-off: 500ms → 1000ms → 2000ms
      const delay = 500 * 2 ** (attempt - 1)
      console.warn(`Attempt ${attempt} failed. Retrying in ${delay}ms…`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}
```

The exponential back-off means transient network hiccups resolve automatically \
without hammering the server.\
""",

    # ── Email / writing ───────────────────────────────────────────────────────
    "write": """\
Here's a polished follow-up email template:

---

**Subject:** Following up — [Topic]

Hi [Name],

I hope you're doing well.

I wanted to follow up on our recent conversation about **[topic]**. \
Based on what we discussed, here are the suggested next steps:

1. **[Action item 1]** — *Owner: You / Due: [Date]*
2. **[Action item 2]** — *Owner: [Name] / Due: [Date]*
3. **[Action item 3]** — *Owner: Both / Due: [Date]*

Please let me know if anything looks off or if you'd like to adjust \
the timeline. Happy to jump on a quick call if that would be easier.

Looking forward to moving this forward.

Best regards,
[Your name]
[Title] · [Company]

---

Want me to adjust the tone (more formal, more casual, or more persuasive)?\
""",

    # ── Explain / general knowledge ───────────────────────────────────────────
    "explain": """\
Great question — let me break this down clearly.

**The core idea** is straightforward once you see the three moving parts:

1. **Input** — what you start with. This could be data, a request, or a trigger \
   from the user or another system.

2. **Processing** — the logic that transforms the input. This is where the \
   interesting work happens: filtering, sorting, calculating, or calling an API.

3. **Output** — the result returned to the caller or displayed in the UI.

**A concrete example:**
```
User clicks "Load data"
  → HTTP GET /api/data          (input)
  → Server queries database     (processing)
  → JSON response sent back     (output)
  → React renders the list      (UI update)
```

The key insight is that keeping these stages separate makes each one \
**independently testable** and much easier to debug.

Would you like me to dive deeper into any specific stage?\
""",

    # ── Default / fallback ────────────────────────────────────────────────────
    "default": """\
That's an interesting question! Here's how I'd approach it:

**Step 1 — Understand the goal**
Before writing any code or making any decisions, clarify exactly what \
success looks like. A clear definition of "done" saves hours of rework.

**Step 2 — Break it into small pieces**
Large problems are hard; small problems are easy. Decompose the task \
into the smallest units that can be built and tested independently.

**Step 3 — Build incrementally**
Start with the simplest thing that works, then layer complexity on top. \
This gives you fast feedback and keeps the codebase understandable.

**Step 4 — Validate as you go**
Write a quick test (or just run the code) after each small piece. \
Catching bugs at the boundary of a single function is far easier than \
debugging a chain of five functions that are all subtly wrong.

Would you like me to apply this approach to your specific problem? \
Share more details and I'll give you a tailored plan.\
""",
}


# =============================================================================
# Public functions
# =============================================================================

def generate_response(user_message: str) -> str:
    """
    Pick and return the best canned reply for the given user message.
    Matching is done by simple keyword scanning — good enough for a mock.

    :param user_message: The raw text the user sent.
    :returns:            A full assistant reply string.
    """
    key = _pick_key(user_message)
    return _RESPONSES[key]


def stream_tokens(text: str):
    """
    Split a full response string into word-level tokens and yield each one
    with a small delay, mimicking a real LLM streaming API.

    Yields:
        (token: str, delay: float)  — the token text and how long to wait
                                      before sending the next one.

    Callers should do:
        for token, delay in stream_tokens(text):
            time.sleep(delay)
            send_to_websocket(token)
    """
    # Split into words while keeping the whitespace attached to each word,
    # so the client reconstructs the text faithfully.
    # Example: "Hello world\nNext" → ["Hello ", "world\n", "Next"]
    words = re.findall(r'\S+\s*|\n+', text)

    for i, word in enumerate(words):
        # Vary the delay slightly to feel organic:
        #   - Punctuation at the end of a sentence  → longer pause (0.06 s)
        #   - Newlines                              → medium pause  (0.04 s)
        #   - Regular words                         → fast          (0.025 s)
        if word.rstrip().endswith(('.', '!', '?', ':')):
            delay = 0.06
        elif '\n' in word:
            delay = 0.04
        else:
            delay = 0.025

        yield word, delay


# =============================================================================
# Private helpers
# =============================================================================

def _pick_key(message: str) -> str:
    """
    Return the response-bank key that best matches the user message.
    Uses a simple priority-ordered keyword scan.
    """
    t = message.lower()

    if any(w in t for w in ("hello", "hi ", "hey ", "good morning", "good evening")):
        return "greeting"

    if any(w in t for w in ("react", "component", "hook", "jsx", "frontend", "dashboard")):
        return "react"

    if any(w in t for w in ("python", "pandas", "numpy", "pip", "django", "flask")):
        return "python"

    if any(w in t for w in ("javascript", "js", "node", "async", "await", "promise", "fetch")):
        return "javascript"

    if any(w in t for w in ("write", "email", "draft", "letter", "message", "compose")):
        return "write"

    if any(w in t for w in ("explain", "what is", "how does", "how do", "why", "describe")):
        return "explain"

    return "default"