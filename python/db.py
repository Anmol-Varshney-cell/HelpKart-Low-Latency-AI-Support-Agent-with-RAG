"""Database layer for HelpKart (Python/Streamlit version).

Same PostgreSQL schema as the original app, so existing chat history,
visitor tokens and the daily question cap all carry over.

Works with:
  - PostgreSQL (Neon):  DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
  - SQLite (local tryout, zero setup): DATABASE_URL=sqlite:///helpkart_local.db
"""

import os
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///helpkart_local.db")
IS_POSTGRES = DATABASE_URL.startswith("postgres")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


# ---------------------------------------------------------------- schema ---

def init_db():
    """Create tables if they do not exist yet (no-op on the existing Neon DB)."""
    if IS_POSTGRES:
        statements = [
            "CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now() NOT NULL)",
            "CREATE TABLE IF NOT EXISTS knowledge_base (id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS conversations (id SERIAL PRIMARY KEY, title TEXT NOT NULL, visitor_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ DEFAULT now())",
            "CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT now())",
        ]
    else:
        statements = [
            "CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL)",
            "CREATE TABLE IF NOT EXISTS knowledge_base (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, visitor_id TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
            "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
        ]
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(text(stmt))


def _as_utc(value):
    """Normalize a created_at value (datetime or string) to an aware UTC datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ------------------------------------------------------------- visitors ---

def visitor_token_exists(token):
    with engine.connect() as conn:
        row = conn.execute(text("SELECT id FROM visitors WHERE id = :t"), {"t": token}).first()
        return row is not None


def create_visitor_token(token=None):
    token = token or secrets.token_hex(32)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO visitors (id) VALUES (:t) ON CONFLICT DO NOTHING")
                     if IS_POSTGRES else
                     text("INSERT OR IGNORE INTO visitors (id) VALUES (:t)"), {"t": token})
    return token


# -------------------------------------------------------- conversations ---

def get_conversations(visitor_id):
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, title, visitor_id, created_at FROM conversations "
                 "WHERE visitor_id = :v ORDER BY created_at DESC"), {"v": visitor_id})
        return [dict(r._mapping) for r in rows]


def get_conversation(conversation_id):
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id, title, visitor_id, created_at FROM conversations WHERE id = :i"),
            {"i": conversation_id}).first()
        return dict(row._mapping) if row else None


def create_conversation(title, visitor_id):
    with engine.begin() as conn:
        if IS_POSTGRES:
            row = conn.execute(
                text("INSERT INTO conversations (title, visitor_id) VALUES (:t, :v) RETURNING id"),
                {"t": title, "v": visitor_id}).first()
        else:
            row = conn.execute(
                text("INSERT INTO conversations (title, visitor_id) VALUES (:t, :v)"),
                {"t": title, "v": visitor_id})
            row = (row.lastrowid,)
        return row[0]


def delete_conversation(conversation_id):
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM messages WHERE conversation_id = :i"), {"i": conversation_id})
        conn.execute(text("DELETE FROM conversations WHERE id = :i"), {"i": conversation_id})


# ------------------------------------------------------------- messages ---

def get_messages(conversation_id):
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, conversation_id, role, content, status, created_at FROM messages "
                 "WHERE conversation_id = :i ORDER BY created_at"), {"i": conversation_id})
        return [dict(r._mapping) for r in rows]


def create_message(conversation_id, role, content, status="pending"):
    with engine.begin() as conn:
        if IS_POSTGRES:
            row = conn.execute(
                text("INSERT INTO messages (conversation_id, role, content, status) "
                     "VALUES (:c, :r, :t, :s) RETURNING id"),
                {"c": conversation_id, "r": role, "t": content, "s": status}).first()
            return row[0]
        row = conn.execute(
            text("INSERT INTO messages (conversation_id, role, content, status) "
                 "VALUES (:c, :r, :t, :s)"),
            {"c": conversation_id, "r": role, "t": content, "s": status})
        return row.lastrowid


def set_message_status(message_id, status):
    with engine.begin() as conn:
        conn.execute(text("UPDATE messages SET status = :s WHERE id = :i"),
                     {"s": status, "i": message_id})


# ----------------------------------------------------- daily question cap ---

def admit_question(visitor_id, conversation_id, question_text, cap=30):
    """Atomically admit a visitor's question under the rolling-24h cap.

    Returns (outcome, message_id) where outcome is one of:
      'admitted'    - the question record is 'pending', go answer it
      'cap_reached' - over the daily cap; the question stays visible as 'failed'
      'in_flight'   - the same question is being answered right now elsewhere

    Only 'answered' questions and still-active 'pending' ones (younger than
    10 minutes) count against the cap. Failed or stale questions stay visible
    in the history but are free. On PostgreSQL a per-visitor advisory lock
    makes concurrent invocations safe; on SQLite the app runs single-process.
    """
    now = datetime.now(timezone.utc)
    window_since = now - timedelta(hours=24)
    pending_since = now - timedelta(minutes=10)

    with engine.begin() as conn:
        if IS_POSTGRES:
            conn.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:v, 0))"),
                         {"v": visitor_id})

        convo_user_msgs = [dict(r._mapping) for r in conn.execute(
            text("SELECT id, content, status, created_at FROM messages "
                 "WHERE conversation_id = :c AND role = 'user' ORDER BY id DESC"),
            {"c": conversation_id})]

        retry = next((m for m in convo_user_msgs
                      if m["content"] == question_text and m["status"] in ("failed", "pending")),
                     None)
        if (retry and retry["status"] == "pending"
                and (_as_utc(retry["created_at"]) or now) >= pending_since):
            return "in_flight", retry["id"]

        if cap > 0:
            rows = [dict(r._mapping) for r in conn.execute(
                text("SELECT m.created_at AS created_at FROM messages m "
                     "JOIN conversations c ON m.conversation_id = c.id "
                     "WHERE c.visitor_id = :v AND m.role = 'user' "
                     "AND (m.status = 'answered' OR m.status = 'pending')"),
                {"v": visitor_id})]
            used = 0
            for r in rows:
                ts = _as_utc(r["created_at"])
                if ts is None or ts < window_since:
                    continue
                used += 1  # 'answered' in window, or 'pending' (stale ones get filtered below)
            # Re-count pending properly: stale pending (crashed) does not count.
            pending_rows = [dict(r._mapping) for r in conn.execute(
                text("SELECT m.created_at AS created_at FROM messages m "
                     "JOIN conversations c ON m.conversation_id = c.id "
                     "WHERE c.visitor_id = :v AND m.role = 'user' AND m.status = 'pending'"),
                {"v": visitor_id})]
            stale_pending = sum(1 for r in pending_rows
                                if (_as_utc(r["created_at"]) or now) < pending_since)
            used -= stale_pending

        if cap > 0 and used >= cap:
            if retry:
                conn.execute(text("UPDATE messages SET status = 'failed' WHERE id = :i"),
                             {"i": retry["id"]})
                return "cap_reached", retry["id"]
            msg_id = _insert_message(conn, conversation_id, "user", question_text, "failed")
            return "cap_reached", msg_id

        if retry:
            conn.execute(text("UPDATE messages SET status = 'pending' WHERE id = :i"),
                         {"i": retry["id"]})
            return "admitted", retry["id"]
        msg_id = _insert_message(conn, conversation_id, "user", question_text, "pending")
        return "admitted", msg_id


def _insert_message(conn, conversation_id, role, content, status):
    if IS_POSTGRES:
        row = conn.execute(
            text("INSERT INTO messages (conversation_id, role, content, status) "
                 "VALUES (:c, :r, :t, :s) RETURNING id"),
            {"c": conversation_id, "r": role, "t": content, "s": status}).first()
        return row[0]
    row = conn.execute(
        text("INSERT INTO messages (conversation_id, role, content, status) "
             "VALUES (:c, :r, :t, :s)"),
        {"c": conversation_id, "r": role, "t": content, "s": status})
    return row.lastrowid


# -------------------------------------------------------- knowledge base ---

SAMPLE_KB = [
    ("Return policy",
     "HelpKart allows returns within 30 days of delivery. Items must be in original condition "
     "with tags and packaging intact. Refunds are issued to the original payment method within "
     "5-7 business days after the returned item is received."),
    ("Shipping times",
     "Standard shipping takes 3-5 business days and is free on orders above Rs 499. "
     "Express shipping takes 1-2 business days for a flat fee of Rs 99. "
     "Orders placed before 5 PM ship the same day."),
    ("Order tracking",
     "Once an order ships, a tracking link is sent by SMS and email. Customers can also track "
     "orders from the My Orders section of their HelpKart account. Tracking updates may take "
     "up to 24 hours to appear after dispatch."),
    ("Cancel an order",
     "Orders can be cancelled free of charge within 12 hours of placing them, or until they "
     "are packed, whichever comes first. After dispatch, the order can be refused at delivery "
     "or returned under the 30-day return policy."),
    ("Payment methods",
     "HelpKart accepts UPI, credit and debit cards, net banking, and cash on delivery (COD) "
     "on eligible orders. COD is available for orders up to Rs 5,000."),
    ("Support hours",
     "Human support agents are available Monday to Saturday, 9 AM to 9 PM IST, via chat and "
     "email at support@helpkart.example. The AI assistant answers common questions 24/7."),
]


def seed_knowledge_base():
    with engine.begin() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM knowledge_base")).scalar()
        if count and count > 0:
            return
        for title, content in SAMPLE_KB:
            conn.execute(text("INSERT INTO knowledge_base (title, content) VALUES (:t, :c)"),
                         {"t": title, "c": content})


def get_knowledge_base_items():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, title, content FROM knowledge_base ORDER BY id"))
        return [dict(r._mapping) for r in rows]


def search_knowledge_base(query, limit=3):
    """Simple keyword search (no embeddings) - the low-latency RAG choice."""
    words = [w for w in re_words(query) if len(w) > 2][:5]
    if not words:
        return []
    clauses = " OR ".join(
        f"(lower(title) LIKE :w{i} OR lower(content) LIKE :w{i})" for i in range(len(words)))
    params = {f"w{i}": f"%{w}%" for i, w in enumerate(words)}
    with engine.connect() as conn:
        rows = conn.execute(
            text(f"SELECT id, title, content FROM knowledge_base WHERE {clauses} LIMIT :lim"),
            {**params, "lim": limit})
        return [dict(r._mapping) for r in rows]


import re as _re


def re_words(query):
    return _re.sub(r"[^a-z0-9\s]", " ", query.lower()).split()
