import { Bot } from "lucide-react";
import { useLocation } from "wouter";
import { useCreateConversation } from "../hooks/use-conversations";

export default function Home() {
  const [, setLocation] = useLocation();
  const { mutate: createConv, isPending } = useCreateConversation();

  const start = () => {
    createConv(
      { title: "New Conversation" },
      { onSuccess: (convo) => setLocation(`/c/${convo.id}`) }
    );
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mb-6">
        <Bot className="w-9 h-9 text-white" />
      </div>
      <h2 className="text-2xl font-semibold mb-2">HelpKart Support</h2>
      <p className="text-slate-500 max-w-md mb-8">
        Ask about returns, shipping, orders, payments and more. The assistant answers
        from the HelpKart knowledge base.
      </p>
      <button
        onClick={start}
        disabled={isPending}
        className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-medium disabled:opacity-60"
      >
        Start a conversation
      </button>
    </div>
  );
}
