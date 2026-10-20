import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { seedDatabase } from "./seed";
import { ai, CHAT_MODEL_CHAIN } from "./gemini";
import { getVoiceConfig, getSubscription, textToSpeech } from "./elevenlabs";
import { api, buildPath } from "../shared/routes";

function sseSend(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Seed database with the sample knowledge base
  await seedDatabase();

  // List all conversations
  app.get(api.conversations.list.path, async (_req, res) => {
    const convos = await storage.getConversations();
    res.json(convos);
  });

  // Get single conversation with messages
  app.get(api.conversations.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const convo = await storage.getConversation(id);
    if (!convo) return res.status(404).json({ message: "Not found" });
    const msgs = await storage.getMessages(id);
    res.json({ ...convo, messages: msgs });
  });

  // Create new conversation
  app.post(api.conversations.create.path, async (req, res) => {
    const input = api.conversations.create.input.parse(req.body);
    const convo = await storage.createConversation(input);
    res.status(201).json(convo);
  });

  // Delete conversation
  app.delete(api.conversations.delete.path, async (req, res) => {
    const id = Number(req.params.id);
    await storage.deleteConversation(id);
    res.status(204).end();
  });

  // List knowledge base entries
  app.get(api.knowledgeBase.list.path, async (_req, res) => {
    const items = await storage.getKnowledgeBaseItems();
    res.json(items);
  });

  // Stream messages - CORE ENDPOINT (SSE)
  app.post(api.conversations.messages.path, async (req, res) => {
    const conversationId = Number(req.params.id);
    const parsed = api.conversations.messages.input.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Missing or invalid 'text'" });
    }
    const { text } = parsed.data;

    const convo = await storage.getConversation(conversationId);
    if (!convo) return res.status(404).json({ message: "Conversation not found" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      // 1. RAG retrieval - inject knowledge base context
      const relevantKb = await storage.searchKnowledgeBase(text);
      const kbContext = relevantKb.map((k) => `${k.title}: ${k.content}`).join("\n");

      // 2. Save user message - but idempotently: if the newest message in this
      // conversation is the SAME unanswered user text (page was refreshed mid-reply
      // or the last attempt failed and the user retried), do not store a duplicate.
      // The retry simply answers the question that is already on record.
      const prior = await storage.getMessages(conversationId);
      const last = prior[prior.length - 1];
      const isRetryOfUnanswered = last && last.role === "user" && last.content === text;
      if (!isRetryOfUnanswered) {
        await storage.createMessage({ conversationId, role: "user", content: text });
      }
      sseSend(res, { type: "user_transcript", data: text });

      // 3. Conversation history
      const existingMessages = await storage.getMessages(conversationId);
      const chatHistory = existingMessages.map((m) => ({
        role: m.role === "assistant" ? ("model" as const) : ("user" as const),
        parts: [{ text: m.content }],
      }));

      // 4. System prompt with RAG context
      const systemPrompt =
        "You are a helpful customer support agent for HelpKart.\n" +
        "You are having a live conversation, keep responses concise and conversational.\n" +
        "Answer only from the knowledge base below when it is relevant; if the answer is not " +
        "there, say honestly that you do not have that information. Do not invent policies " +
        "and do not promise actions you cannot take, such as connecting the customer to a " +
        "human agent - this chat has no handoff feature. If a support-hours or contact " +
        "knowledge-base entry is included above, you may share those details as-is.\n" +
        `Knowledge base:\n${kbContext || "(no matching entries found)"}`;

      if (!ai) {
        sseSend(res, {
          type: "error",
          error:
            "GEMINI_API_KEY is not configured on the server. Add a free key from " +
            "https://aistudio.google.com/apikey to the environment and restart.",
        });
        return res.end();
      }

      // 5. Stream response via SSE (Gemini free tier, text).
      // Free-tier models sometimes return transient 503/429 under provider
      // congestion. Retry the stream SETUP a bounded number of times (nothing
      // has been sent to the client yet, so retrying is safe); if the provider
      // is still busy, fail honestly and tell the user to try again. A failure
      // mid-stream (after chunks were sent) is never retried - that would
      // duplicate text - it surfaces as an honest error instead.
      const RETRYABLE = new Set([429, 503]);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Provider congestion can also look like a request that never answers.
      // Bound every wait so the UI never spins forever.
      class StallError extends Error {
        status = 503;
      }
      const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
        Promise.race([
          p,
          sleep(ms).then(() => {
            throw new StallError(`${what} timed out after ${ms / 1000}s (provider not responding)`);
          }),
        ]);

      let stream: Awaited<ReturnType<typeof ai.models.generateContentStream>> | null = null;
      let setupErr: unknown = null;
      let usedModel = "";
      // Walk the free-tier fallback chain: one retry per model, then move on.
      // If every model is busy the user gets the honest error below.
      for (const model of CHAT_MODEL_CHAIN) {
        if (stream) break;
        for (let attempt = 0; attempt < 2 && !stream; attempt++) {
          try {
            stream = await withTimeout(
              ai.models.generateContentStream({
                model,
                contents: chatHistory,
                config: { systemInstruction: systemPrompt },
              }),
              30_000,
              "stream setup"
            );
            usedModel = model;
            if (model !== CHAT_MODEL_CHAIN[0]) {
              console.warn(`[messages] primary model busy; answered via fallback ${model}`);
            }
          } catch (err) {
            setupErr = err;
            const status = (err as { status?: number })?.status;
            if (status && RETRYABLE.has(status) && attempt < 1) {
              console.warn(`[messages] ${model} busy (status ${status}), one retry`);
              await sleep(3000);
              continue;
            }
            break; // next model in the chain
          }
        }
      }
      if (!stream) {
        const status = (setupErr as { status?: number })?.status;
        console.error("[messages] stream setup failed:", setupErr);
        sseSend(res, {
          type: "error",
          error:
            status && RETRYABLE.has(status)
              ? "The AI service is temporarily busy (high demand on the free tier). Please try again in a minute."
              : setupErr instanceof Error
                ? setupErr.message
                : "Unknown error while generating reply",
        });
        return res.end();
      }

      let assistantTranscript = "";

      // Manual iteration with a per-chunk inactivity bound: if the provider
      // stops answering mid-reply, surface an honest error instead of hanging.
      const iterator = stream[Symbol.asyncIterator]();
      while (true) {
        const next = await withTimeout(iterator.next(), 45_000, "reply stream");
        if (next.done) break;
        const part = next.value.text;
        if (part) {
          assistantTranscript += part;
          sseSend(res, { type: "transcript", data: part });
        }
      }

      // 6. Persist assistant message after streaming completes
      await storage.createMessage({
        conversationId,
        role: "assistant",
        content: assistantTranscript,
      });

      sseSend(res, { type: "done", transcript: assistantTranscript });
      res.end();
    } catch (err) {
      console.error("[messages] stream error:", err);
      sseSend(res, {
        type: "error",
        error: err instanceof Error ? err.message : "Unknown error while generating reply",
      });
      res.end();
    }
  });

  // Voice output status (client uses this to show/hide the listen button)
  app.get("/api/voice/status", (_req, res) => {
    res.json({ enabled: getVoiceConfig() !== null });
  });

  // Generate speech for one assistant message - ONLY on explicit user request.
  const speakAttempts: number[] = [];
  const speakInflight = new Map<number, Promise<void>>();
  const SPEAK_RATE_LIMIT_PER_MIN = 5;
  const SPEAK_MAX_CHARS = 2000;

  app.post("/api/messages/:id/speak", async (req, res) => {
    const cfg = getVoiceConfig();
    if (!cfg) {
      return res.status(503).json({ message: "Voice output is not enabled on this server." });
    }

    const messageId = Number(req.params.id);
    const msg = await storage.getMessage(messageId);
    if (!msg || msg.role !== "assistant") {
      return res.status(404).json({ message: "Assistant message not found" });
    }

    // 1. Cache: never generate the same message twice
    const cached = await storage.getMessageAudio(messageId);
    if (cached) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("X-Audio-Cache", "hit");
      return res.send(Buffer.from(cached.audioBase64, "base64"));
    }

    if (msg.content.length > SPEAK_MAX_CHARS) {
      return res.status(413).json({ message: "Message too long for voice output." });
    }

    // 2. Rate limit (conservative bound for shared/public servers)
    const now = Date.now();
    while (speakAttempts.length && now - speakAttempts[0] > 60_000) speakAttempts.shift();
    if (speakAttempts.length >= SPEAK_RATE_LIMIT_PER_MIN) {
      return res.status(429).json({ message: "Too many voice requests. Try again in a minute." });
    }

    // 3. Local monthly budget (secondary guard)
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const usedChars = await storage.getMonthlyAudioChars(monthStart);
    if (usedChars + msg.content.length > cfg.monthlyCharBudget) {
      return res.status(402).json({
        message: "Monthly voice budget reached. Audio paused to protect the free quota.",
      });
    }

    // 4. Live account balance check (primary guard)
    try {
      const sub = await getSubscription(cfg);
      // Fail closed on paid tiers: the user's approval covers free credits only,
      // so a paid plan (or one we cannot identify) blocks generation entirely.
      if (!sub.tier || sub.tier !== "free") {
        return res.status(402).json({
          message:
            "This ElevenLabs account is not on the free plan. Voice test is blocked " +
            "because only free credits were approved.",
        });
      }
      if (
        typeof sub.characterCount === "number" &&
        typeof sub.characterLimit === "number" &&
        sub.characterLimit - sub.characterCount < msg.content.length
      ) {
        return res.status(402).json({
          message: "ElevenLabs free quota is nearly used up. Audio paused.",
        });
      }
    } catch (err) {
      console.error("[voice] subscription check failed:", err);
      return res.status(502).json({ message: "Could not verify voice quota. Try later." });
    }

    // 5. Generate, cache, return. Concurrent clicks on the same uncached
    // message share ONE generation so a cache miss can never double-spend.
    speakAttempts.push(now);
    if (speakInflight.has(messageId)) {
      await speakInflight.get(messageId);
      const afterWait = await storage.getMessageAudio(messageId);
      if (afterWait) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("X-Audio-Cache", "shared");
        return res.send(Buffer.from(afterWait.audioBase64, "base64"));
      }
      return res.status(502).json({ message: "Voice generation failed. Try again." });
    }

    const generation = (async () => {
      try {
        const audio = await textToSpeech(cfg, msg.content);
        await storage.saveMessageAudio(
          messageId,
          audio.toString("base64"),
          msg.content.length
        );
      } catch (err) {
        console.error("[voice] TTS failed:", err);
      } finally {
        speakInflight.delete(messageId);
      }
    })();
    speakInflight.set(messageId, generation);
    await generation;

    const saved = await storage.getMessageAudio(messageId);
    if (!saved) {
      return res.status(502).json({ message: "Voice generation failed. Try again." });
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Audio-Cache", "generated");
    res.send(Buffer.from(saved.audioBase64, "base64"));
  });

  // Health check
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Silence unused-import lint for buildPath (exported for clients/tests)
  void buildPath;

  return httpServer;
}
