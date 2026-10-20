// ElevenLabs voice output (assistant replies spoken aloud).
//
// Deliberately OFF unless all three env vars are set:
//   ELEVENLABS_API_KEY      - the account's API key (never commit it)
//   ELEVENLABS_VOICE_ID     - the voice to speak with
//   ELEVENLABS_VOICE_ENABLED=true
//
// Quota safety:
// - Audio is generated ONLY on explicit user click (never automatically).
// - Generated audio is cached per message; the same reply never spends twice.
// - Before every generation the live account balance is checked against the
//   ElevenLabs API; generation is refused when the remainder is too low.
// - A local monthly character budget and a rate limit add a second guard.
// - On the ElevenLabs free plan, published audio requires attribution to
//   elevenlabs.io - the UI shows "Voice by elevenlabs.io" when voice is on.

const API_BASE = "https://api.elevenlabs.io";

export interface VoiceConfig {
  apiKey: string;
  voiceId: string;
  model: string;
  monthlyCharBudget: number;
}

export function getVoiceConfig(): VoiceConfig | null {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const enabled = process.env.ELEVENLABS_VOICE_ENABLED === "true";
  if (!enabled || !apiKey || !voiceId) return null;
  return {
    apiKey,
    voiceId,
    model: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
    monthlyCharBudget: Number(process.env.ELEVENLABS_MONTHLY_CHAR_BUDGET || 2000),
  };
}

export interface SubscriptionInfo {
  tier?: string;
  characterCount?: number;
  characterLimit?: number;
  raw: unknown;
}

export async function getSubscription(cfg: VoiceConfig): Promise<SubscriptionInfo> {
  const res = await fetch(`${API_BASE}/v1/user/subscription`, {
    headers: { "xi-api-key": cfg.apiKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs subscription check failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return {
    tier: data.tier as string | undefined,
    characterCount: data.character_count as number | undefined,
    characterLimit: data.character_limit as number | undefined,
    raw: data,
  };
}

export async function getVoice(cfg: VoiceConfig): Promise<{ voice_id?: string; name?: string }> {
  const res = await fetch(`${API_BASE}/v1/voices/${cfg.voiceId}`, {
    headers: { "xi-api-key": cfg.apiKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs voice lookup failed: ${res.status}`);
  return (await res.json()) as { voice_id?: string; name?: string };
}

export async function textToSpeech(cfg: VoiceConfig, text: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/v1/text-to-speech/${cfg.voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": cfg.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: cfg.model,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
