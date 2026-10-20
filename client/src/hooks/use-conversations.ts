import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "../lib/queryClient";

export interface Conversation {
  id: number;
  title: string;
  createdAt: string | null;
}

export interface Message {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string | null;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export function useConversations() {
  return useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });
}

export function useConversation(id: number) {
  return useQuery<ConversationWithMessages>({
    queryKey: [`/api/conversations/${id}`],
    enabled: Number.isFinite(id),
  });
}

export function useCreateConversation() {
  return useMutation({
    mutationFn: (input: { title: string }) =>
      apiRequest<Conversation>("POST", "/api/conversations", input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] }),
  });
}

export function useDeleteConversation() {
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest<void>("DELETE", `/api/conversations/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] }),
  });
}

export interface KnowledgeBaseItem {
  id: number;
  title: string;
  content: string;
}

export function useKnowledgeBase() {
  return useQuery<KnowledgeBaseItem[]>({
    queryKey: ["/api/knowledge-base"],
  });
}
