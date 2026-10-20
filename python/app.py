"""HelpKart - AI customer-support agent with RAG (Python/Flask version).

A support chat that answers from a small knowledge base using Gemini's free
tier, with per-browser private history and a fair-use daily question cap.

Configuration (environment variables):
  DATABASE_URL               postgres://... (Neon) or sqlite:///local.db
  GEMINI_API_KEY             free key from https://aistudio.google.com/apikey
  GEMINI_MODEL               default gemini-3.8-flash
  GEMINI_FALLBACK_MODELS     default gemini-3.6-flash,gemini-3.5-flash-lite
  DEMO_DAILY_QUESTION_CAP    max answered questions per visitor per 24h (default 30, 0 disables)
"""

import json
import os
import secrets

from flask import Flask, Response, jsonify, request, send_file

import db
import gemini_client

app = Flask(__name__, static_folder="static", static_url_path="/static")

DAILY_CAP = int(os.environ.get("DEMO_DAILY_QUESTION_CAP", "30"))

db.init_db()
db.seed_knowledge_base()

SYSTEM_PROMPT_TEMPLATE = (
    "You are a helpful customer support agent for HelpKart.\n"
    "You are having a live conversation, keep responses concise and conversational.\n"
    "Answer only from the knowledge base below when it is relevant; if the answer is not "
    "there, say honestly that you do not have that information. Do not invent policies "
    "and do not promise actions you cannot take, such as connecting the customer to a "
    "human agent - this chat has no handoff feature. If a support-hours or contact "
    "knowledge-base entry is included above, you may share those details as-is.\n"
    "Knowledge base:\n{kb}"
)


# ------------------------------------------------------- visitor identity ---

@app.before_request
def visitor_cookie():
    """Anonymous per-browser identity for the public demo.

    The server sets an HttpOnly cookie holding an opaque random token, and
    every conversation belongs to the visitor that created it. Only tokens
    the server issued (present in the visitors table) are honored, so a
    made-up cookie value gets a fresh empty namespace, never someone else's
    history. This is privacy isolation, not authentication.
    """
    if not request.path.startswith("/api"):
        return None
    token = request.cookies.get("hk_visitor", "")
    if not _valid_token_format(token) or not db.visitor_token_exists(token):
        token = db.create_visitor_token(secrets.token_hex(32))
        request.new_visitor_token = token  # set cookie after the response
    request.visitor_id = token
    return None


@app.after_request
def save_visitor_cookie(response):
    token = getattr(request, "new_visitor_token", None)
    if token:
        response.set_cookie("hk_visitor", token, max_age=31536000,
                            httponly=True, samesite="Lax", path="/")
    return response


def _valid_token_format(token):
    return bool(token) and len(token) == 64 and all(c in "0123456789abcdefABCDEF" for c in token)


def _owned_conversation(conversation_id):
    convo = db.get_conversation(conversation_id)
    if not convo or convo["visitor_id"] != request.visitor_id:
        return None
    return convo


# ---------------------------------------------------------------- routes ---

@app.get("/")
def home():
    return send_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "index.html"))


@app.get("/api/health")
def health():
    return jsonify({"ok": True})


@app.get("/api/conversations")
def list_conversations():
    return jsonify(db.get_conversations(request.visitor_id))


@app.get("/api/conversations/<int:conversation_id>")
def get_conversation(conversation_id):
    convo = _owned_conversation(conversation_id)
    if not convo:
        return jsonify({"message": "Not found"}), 404
    convo["messages"] = db.get_messages(conversation_id)
    return jsonify(convo)


@app.post("/api/conversations")
def create_conversation():
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "New Conversation").strip() or "New Conversation"
    new_id = db.create_conversation(title, request.visitor_id)
    return jsonify(db.get_conversation(new_id)), 201


@app.delete("/api/conversations/<int:conversation_id>")
def delete_conversation(conversation_id):
    if not _owned_conversation(conversation_id):
        return jsonify({"message": "Not found"}), 404
    db.delete_conversation(conversation_id)
    return "", 204


@app.get("/api/knowledge-base")
def list_knowledge_base():
    return jsonify(db.get_knowledge_base_items())


def sse(payload):
    return f"data: {json.dumps(payload)}\n\n"


@app.post("/api/conversations/<int:conversation_id>/messages")
def stream_message(conversation_id):
    convo = _owned_conversation(conversation_id)
    if not convo:
        return jsonify({"message": "Conversation not found"}), 404
    body = request.get_json(silent=True) or {}
    question = (body.get("text") or "").strip()
    if not question:
        return jsonify({"message": "Missing or invalid 'text'"}), 400

    visitor_id = request.visitor_id  # capture: no request context inside the stream

    def generate():
        # Honest accounting: a question that never gets an assistant answer is
        # marked 'failed' - it stays visible in the visitor's history but never
        # counts against the daily cap, and retrying it reuses the same record.
        admitted_message_id = None

        def mark_failed():
            nonlocal admitted_message_id
            if admitted_message_id is not None:
                mid, admitted_message_id = admitted_message_id, None
                try:
                    db.set_message_status(mid, "failed")
                except Exception:
                    pass

        try:
            # 1. RAG retrieval - inject knowledge base context
            relevant = db.search_knowledge_base(question)
            kb_context = "\n".join(f"{k['title']}: {k['content']}" for k in relevant)
            system_prompt = SYSTEM_PROMPT_TEMPLATE.format(kb=kb_context or "(no matching entries found)")

            # 2. Admit the question atomically under the rolling-24h cap.
            outcome, message_id = db.admit_question(
                visitor_id, conversation_id, question, cap=DAILY_CAP)
            if outcome == "cap_reached":
                yield sse({"type": "error",
                           "error": f"Daily demo limit reached ({DAILY_CAP} questions per visitor). "
                                    "Please try again tomorrow."})
                return
            if outcome == "in_flight":
                yield sse({"type": "error",
                           "error": "This question is already being answered - please wait a moment."})
                return
            admitted_message_id = message_id

            yield sse({"type": "user_transcript", "data": question})

            # 3. Conversation history (includes the question just admitted)
            history = [
                {"role": "model" if m["role"] == "assistant" else "user",
                 "parts": [{"text": m["content"]}]}
                for m in db.get_messages(conversation_id)
            ]

            if gemini_client.client is None:
                mark_failed()
                yield sse({"type": "error",
                           "error": "GEMINI_API_KEY is not configured on the server. Add a free key "
                                    "from https://aistudio.google.com/apikey and restart."})
                return

            # 4. Open the stream, walking the free-tier fallback chain. A
            # failure here (before any chunk was sent) is safe to retry; a
            # failure mid-stream is never retried - that would duplicate text.
            try:
                stream, _used_model = gemini_client.open_chat_stream(history, system_prompt)
            except Exception as err:
                mark_failed()
                if gemini_client._status_of(err) in gemini_client.RETRYABLE_CODES:
                    msg = ("The AI service is temporarily busy (high demand on the free tier). "
                           "Please try again in a minute.")
                else:
                    msg = str(err) or "Unknown error while generating reply"
                yield sse({"type": "error", "error": msg})
                return

            # 5. Stream chunks to the browser as they arrive
            assistant_text = ""
            for chunk in stream:
                part = getattr(chunk, "text", None)
                if part:
                    assistant_text += part
                    yield sse({"type": "transcript", "data": part})

            # 6. Persist the answer after streaming completes
            db.create_message(conversation_id, "assistant", assistant_text, status="answered")
            db.set_message_status(message_id, "answered")
            admitted_message_id = None
            yield sse({"type": "done", "transcript": assistant_text})
        except Exception as err:
            mark_failed()
            yield sse({"type": "error", "error": str(err) or "Unknown error while generating reply"})

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, threaded=True)
