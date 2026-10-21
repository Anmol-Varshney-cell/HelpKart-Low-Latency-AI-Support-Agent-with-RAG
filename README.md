# HelpKart - AI Customer-Support Agent with RAG (Python)

A customer-support chatbot for a demo e-commerce store. It answers questions
about returns, shipping, orders and payments from a small knowledge base
using retrieval-augmented generation (RAG) on Google's Gemini free tier.

Live demo: https://helpkart-ai-agent-with-rag.vercel.app

## What it does

- Chat interface where visitors ask support questions and watch the answer
  stream in token by token
- RAG: each question searches a knowledge base (simple keyword search, no
  embeddings - the low-latency choice) and the matching entries are injected
  into the AI's instructions, so answers stay grounded in store policy
- Every browser gets its own private chat history (anonymous server-issued
  cookie, no login)
- Fair-use limit: 30 questions per visitor per rolling 24 hours, enforced
  atomically in the database. Only answered questions and ones still being
  processed count; a question that fails to get an answer (provider busy, or
  timed out) stays visible in the history but never counts against the
  limit, and retrying it reuses the same record
- Free-tier model fallback: if the primary Gemini model is rate-limited, the
  app automatically tries the next free model before telling the visitor the
  service is busy

## Tech stack (all Python on the server)

- **Flask** - web server and JSON/SSE API (`python/app.py`)
- **PostgreSQL** (Neon, free tier) - conversations, messages, knowledge
  base, visitor tokens (`python/db.py`, SQLAlchemy)
- **Google Gemini** free tier - chat model with streaming and a fallback
  chain (`python/gemini_client.py`)
- One plain HTML page (`python/static/index.html`) - no frontend framework
- Deployed on **Vercel** (Python runtime)

## Project layout

```
app.py                  Repo-root entrypoint that Vercel runs; loads the real app
requirements.txt        Python dependencies (installed by Vercel)
python/
  app.py                Flask app: routes, visitor cookie, streaming chat endpoint
  db.py                 Database layer: schema, history, daily question cap, RAG search
  gemini_client.py      Gemini client + free-tier fallback chain
  static/index.html     The chat page
  .env.example          Template of the environment variables
client/ server/ shared/ Previous TypeScript (React/Express) version, kept for reference
```

## Run locally

```bash
pip install -r requirements.txt
export GEMINI_API_KEY=your-gemini-key    # Windows CMD: set GEMINI_API_KEY=your-gemini-key
python app.py                            # http://localhost:5000
```

Without a DATABASE_URL it falls back to a local SQLite file, so you can try
everything with just a Gemini key. To use PostgreSQL instead, set
DATABASE_URL as shown in `python/.env.example`.

## Configuration

Environment variables (see `python/.env.example`):

- `GEMINI_API_KEY` - free key from https://aistudio.google.com/apikey
- `DATABASE_URL` - PostgreSQL (Neon) or `sqlite:///helpkart_local.db` (the default)
- `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` - model chain (the defaults work out of the box)
- `DEMO_DAILY_QUESTION_CAP` - daily question limit per visitor (default 30, 0 disables)
