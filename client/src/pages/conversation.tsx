import { useEffect, useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";
import { useConversation } from "../hooks/use-conversations";
import { useChatStream } from "../hooks/use-chat-stream";
import { useVoiceStatus, useSpeak } from "../hooks/use-voice";
import { ChatMessage } from "../components/chat-message";

interface ConversationPageProps {
  params: { id: string };
}

export default function ConversationPage({ params }: ConversationPageProps) {
  const conversationId = Number(params.id);
  const { data: conversation } = useConversation(conversationId);
  const {
    sendMessage,
    isStreaming,
    streamingText,
    optimisticUserMessage,
    streamError,
  } = useChatStream({ conversationId });
  const { data: voiceStatus } = useVoiceStatus();
  const { speak, speakingId, speakError } = useSpeak();
  const voiceEnabled = voiceStatus?.enabled === true;

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages?.length, streamingText, optimisticUserMessage]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
        {conversation?.messages?.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            messageId={msg.id}
            voiceEnabled={voiceEnabled}
            isSpeaking={speakingId === msg.id}
            onSpeak={speak}
          />
        ))}

        {optimisticUserMessage && (
          <ChatMessage role="user" content={optimisticUserMessage} />
        )}
        {(isStreaming || streamingText) && (
          <ChatMessage role="assistant" content={streamingText} isStreaming />
        )}
        {speakError && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            {speakError}
          </div>
        )}
        {streamError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {streamError}
          </div>
        )}
        {conversation && conversation.messages.length === 0 && !optimisticUserMessage && (
          <p className="text-center text-slate-400 text-sm pt-10">
            Ask a question, for example: "What is your return policy?"
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-white p-4">
        {voiceEnabled && (
          <p className="max-w-3xl mx-auto text-[11px] text-slate-400 pb-2">
            Voice by elevenlabs.io
          </p>
        )}
        <div className="max-w-3xl mx-auto flex gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your question..."
            className="flex-1 rounded-xl border px-4 py-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="px-4 py-3 rounded-xl bg-indigo-600 text-white disabled:opacity-50"
            aria-label="Send"
          >
            <SendHorizonal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
