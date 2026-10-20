import { z } from "zod";
import { insertConversationSchema } from "./schema";

// Single source of truth for the API contract
export const api = {
  conversations: {
    list: { method: "GET" as const, path: "/api/conversations" as const },
    get: { method: "GET" as const, path: "/api/conversations/:id" as const },
    create: {
      method: "POST" as const,
      path: "/api/conversations" as const,
      input: insertConversationSchema,
    },
    delete: { method: "DELETE" as const, path: "/api/conversations/:id" as const },
    messages: {
      method: "POST" as const,
      path: "/api/conversations/:id/messages" as const,
      input: z.object({ text: z.string().min(1) }),
    },
  },
  knowledgeBase: {
    list: { method: "GET" as const, path: "/api/knowledge-base" as const },
  },
};

export function buildPath(path: string, params: Record<string, string | number>): string {
  let out = path;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(`:${key}`, String(value));
  }
  return out;
}
