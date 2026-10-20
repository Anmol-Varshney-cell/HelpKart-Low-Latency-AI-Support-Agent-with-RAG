import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface UseChatStreamOptions {
  conversationId: number;
}

// Streams a message to the backend and accumulates the SSE reply in real time.
export function useChatStream({ conversationId }: UseChatStreamOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [optimisticUserMessage, setOptimisticUserMessage] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      setIsStreaming(true);
      setStreamingText("");
      setStreamError(null);
      setOptimisticUserMessage(text); // Optimistic UI

      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            if (part.startsWith("data: ")) {
              try {
                const data = JSON.parse(part.slice(6));
                if (data.type === "transcript") {
                  setStreamingText((prev) => prev + data.data); // Real-time update
                } else if (data.type === "error") {
                  setStreamError(String(data.error));
                }
              } catch {
                // ignore malformed SSE chunk
              }
            }
          }
        }
      } catch (err) {
        setStreamError(err instanceof Error ? err.message : "Stream failed");
      } finally {
        setIsStreaming(false);
        setOptimisticUserMessage("");
        setStreamingText("");

        // Refresh conversation after save completes
        queryClient.invalidateQueries({
          queryKey: [`/api/conversations/${conversationId}`],
        });
      }
    },
    [conversationId, isStreaming, queryClient]
  );

  return { sendMessage, isStreaming, streamingText, optimisticUserMessage, streamError };
}
