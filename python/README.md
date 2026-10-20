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
- Fair-use limit: 30 answered questions per visitor per rolling 24 hours,
  enforced atomically in the database. A question that fails to get an answer
  (provider busy) stays visible but never counts against the limit, and
  retrying it reuses the same record
- Free-tier model fallback: if the primary Gemini model is rate-limited, the
  app automatically tries the next free model before telling the visitor the
  service is busy

## Tech stack (all Python on the server)

- **Flask** - web server and JSON/SSE API (`app.py`)
- **PostgreSQL** (Neon, free tier) - conversations, messages, knowledge base,
  visitor tokens (`db.py`, SQLAlchemy)
- **Google Gemini** free tier - chat model with streaming and a fallback
  chain (`gemini_client.py`)
- One plain HTML page (`static/index.html`) - no frontend framework
- Deployed on **Vercel** (Python runtime)

## Project layout

```
app.py             Flask app: routes, visitor cookie, streaming chat endpoint
db.py              Database layer: schema, history, daily question cap, RAG search
gemini_client.py   Gemini client + free-tier fallback chain
static/index.html  The chat page
requirements.txt   Python dependencies
```

## Run locally

```bash
pip install -r requirements.txt
cp .env.example .env    # add your Gemini key and database URL
python app.py           # http://localhost:5000
```

Without a database URL it falls back to a local SQLite file, so you can try
everything with just a Gemini key.
