import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Bot, Plus, MessageSquare, Trash2, BookOpen, Menu } from "lucide-react";
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
} from "../hooks/use-conversations";
import { KnowledgeBaseModal } from "./knowledge-base-modal";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isKbOpen, setIsKbOpen] = useState(false);

  const { data: conversations } = useConversations();
  const { mutate: createConv, isPending: isCreating } = useCreateConversation();
  const { mutate: deleteConv } = useDeleteConversation();

  const handleNewChat = () => {
    createConv(
      { title: "New Conversation" },
      {
        onSuccess: (convo) => {
          setLocation(`/c/${convo.id}`);
          setIsSidebarOpen(false);
        },
      }
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-72 bg-slate-100 border-r flex flex-col transition-transform md:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold">HelpKart</h1>
        </div>

        {/* New Chat Button */}
        <div className="px-4 pb-4 space-y-2">
          <button
            onClick={handleNewChat}
            disabled={isCreating}
            className="w-full flex items-center gap-2 px-4 py-3 rounded-xl font-medium bg-indigo-600 text-white disabled:opacity-60"
          >
            <Plus className="w-4 h-4" /> New Chat
          </button>
          <button
            onClick={() => setIsKbOpen(true)}
            className="w-full flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-600 hover:bg-black/5"
          >
            <BookOpen className="w-4 h-4" /> View Knowledge Base
          </button>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1">
          {conversations?.map((conv) => {
            const isActive = location === `/c/${conv.id}`;
            return (
              <Link
                key={conv.id}
                href={`/c/${conv.id}`}
                className={`flex items-center justify-between px-3 py-3 rounded-xl ${
                  isActive ? "bg-white shadow-sm" : "hover:bg-black/5"
                }`}
                onClick={() => setIsSidebarOpen(false)}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <MessageSquare className="w-4 h-4 shrink-0 text-slate-500" />
                  <span className="text-sm truncate">{conv.title}</span>
                </span>
                <button
                  aria-label="Delete conversation"
                  onClick={(e) => {
                    e.preventDefault();
                    deleteConv(conv.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
                </button>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-2 p-3 border-b bg-white">
          <button onClick={() => setIsSidebarOpen(true)} aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-medium">HelpKart Support</span>
        </div>
        {children}
      </main>

      <KnowledgeBaseModal open={isKbOpen} onClose={() => setIsKbOpen(false)} />
    </div>
  );
}
