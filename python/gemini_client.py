"""Gemini chat client with a free-tier fallback chain.

Free-tier models sometimes return transient 429/503 under provider
congestion. The app walks a chain of free-tier models: one retry per model,
then the next. If every model is busy, the user gets an honest error.
"""

import itertools
import os
import time

from google import genai
from google.genai import types

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# gemini-2.5-flash (the model the original spec named) now returns 404 for new
# keys, so the default is the free-tier model the API steers new keys to.
CHAT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
CHAT_MODEL_CHAIN = [CHAT_MODEL] + [
    m.strip()
    for m in os.environ.get("GEMINI_FALLBACK_MODELS", "gemini-3.6-flash,gemini-3.5-flash-lite").split(",")
    if m.strip() and m.strip() != CHAT_MODEL
]

RETRYABLE_CODES = {429, 503}

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def _status_of(err):
    return getattr(err, "code", None) or getattr(err, "status_code", None)


def open_chat_stream(chat_history, system_prompt):
    """Open a streaming reply, walking the fallback chain.

    Returns (stream, model_name). Raises the last error if every model fails;
    callers turn that into an honest 'provider busy' message.

    The SDK starts the HTTP request lazily, so provider errors (429/503)
    surface on the FIRST chunk, not at the call. Pull that first chunk here,
    inside the retry scope: failing before any chunk is safe to retry because
    nothing has been sent to the visitor yet. A failure later in the stream
    is never retried - that would duplicate text.
    """
    last_err = None
    for model in CHAT_MODEL_CHAIN:
        for attempt in range(2):
            try:
                stream = client.models.generate_content_stream(
                    model=model,
                    contents=chat_history,
                    config=types.GenerateContentConfig(system_instruction=system_prompt),
                )
                iterator = iter(stream)
                first = next(iterator)  # provider errors surface here
                return itertools.chain([first], iterator), model
            except StopIteration:
                return iter([]), model  # valid but empty reply
            except Exception as err:  # google.genai.errors.APIError and friends
                last_err = err
                if _status_of(err) in RETRYABLE_CODES and attempt < 1:
                    time.sleep(3)
                    continue
                break  # next model in the chain
    raise last_err
