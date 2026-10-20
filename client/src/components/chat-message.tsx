import { motion } from "framer-motion";
import { Bot, User, Volume2, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  messageId?: number;
  voiceEnabled?: boolean;
  isSpeaking?: boolean;
  onSpeak?: (messageId: number) => void;
}

export function ChatMessage({
  role,
  content,
  isStreaming,
  messageId,
  voiceEnabled,
  isSpeaking,
  onSpeak,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-4 w-full ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-indigo-600" : "bg-white border"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-indigo-600" />
        )}
      </div>

      {/* Message Bubble */}
      <div
        className={`max-w-[85%] px-5 py-4 rounded-2xl text-[15px] leading-relaxed ${
          isUser ? "bg-indigo-600 text-white" : "bg-white border shadow-sm"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || "..."}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 ml-1 bg-indigo-600 animate-pulse" />
            )}
          </div>
        )}

        {/* Voice output: explicit per-message listen button (never automatic) */}
        {!isUser && voiceEnabled && messageId != null && !isStreaming && content && (
          <button
            onClick={() => onSpeak?.(messageId)}
            disabled={isSpeaking}
            className="mt-2 flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            aria-label="Listen to this reply"
          >
            {isSpeaking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
            {isSpeaking ? "Playing..." : "Listen"}
          </button>
        )}
      </div>
    </motion.div>
  );
}
