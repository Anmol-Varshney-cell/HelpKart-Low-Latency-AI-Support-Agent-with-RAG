import { useQuery } from "@tanstack/react-query";
import { useState, useCallback } from "react";

export function useVoiceStatus() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ["/api/voice/status"],
  });
}

// Generates (or loads cached) speech for one assistant message and plays it.
export function useSpeak() {
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [speakError, setSpeakError] = useState<string | null>(null);

  const speak = useCallback(async (messageId: number) => {
    setSpeakingId(messageId);
    setSpeakError(null);
    try {
      const res = await fetch(`/api/messages/${messageId}/speak`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `Voice request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play();
      // keep speakingId until playback ends
      await new Promise<void>((resolve) => {
        audio.onended = () => {
          setSpeakingId(null);
          URL.revokeObjectURL(url);
          resolve();
        };
        audio.onerror = () => {
          setSpeakingId(null);
          resolve();
        };
      });
    } catch (err) {
      setSpeakError(err instanceof Error ? err.message : "Voice playback failed");
      setSpeakingId(null);
    }
  }, []);

  return { speak, speakingId, speakError, setSpeakError };
}
