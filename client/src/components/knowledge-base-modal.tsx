import { X } from "lucide-react";
import { useKnowledgeBase } from "../hooks/use-conversations";

interface KnowledgeBaseModalProps {
  open: boolean;
  onClose: () => void;
}

export function KnowledgeBaseModal({ open, onClose }: KnowledgeBaseModalProps) {
  const { data: items, isLoading } = useKnowledgeBase();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold">Knowledge Base</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          {isLoading && <p className="text-slate-500 text-sm">Loading...</p>}
          {items?.map((item) => (
            <div key={item.id} className="border rounded-xl p-4">
              <h3 className="font-medium text-sm">{item.title}</h3>
              <p className="text-sm text-slate-600 mt-1">{item.content}</p>
            </div>
          ))}
          {items && items.length === 0 && (
            <p className="text-slate-500 text-sm">No knowledge base entries yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
