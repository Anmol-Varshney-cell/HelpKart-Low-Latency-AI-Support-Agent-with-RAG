import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn(
    "[gemini] GEMINI_API_KEY is not set. Chat replies will fail until you add a free key " +
    "from https://aistudio.google.com/apikey (see .env.example)."
  );
}

export const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Free-tier Gemini model used for the support chat.
// NOTE: gemini-2.5-flash (the model the original README specced) now returns
// 404 "no longer available to new users" from the Gemini API. The API itself
// steers new keys to gemini-3.8-flash, which is the free-tier default here.
// Override with GEMINI_MODEL if Google retires this one too.
export const CHAT_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Free-tier fallback chain, tried in order when the primary model is
// rate-limited / congested (429/503) or not responding. Every model here has
// a verified free tier (ai.google.dev/gemini-api/docs/pricing) and was tested
// live on a free project. Override with GEMINI_FALLBACK_MODELS (comma-separated).
export const CHAT_MODEL_CHAIN: string[] = [
  CHAT_MODEL,
  ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m && m !== CHAT_MODEL),
];
