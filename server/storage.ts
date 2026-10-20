import { eq, and, or, ilike, desc, gte, sql } from "drizzle-orm";
import { db } from "./db.js";
import {
  conversations,
  messages,
  knowledgeBase,
  messageAudio,
  type Conversation,
  type Message,
  type KnowledgeBase,
  type InsertConversation,
  type InsertMessage,
  type MessageAudio,
  visitors,
} from "../shared/schema.js";

export interface IStorage {
  // Conversations
  getConversations(visitorId: string): Promise<Conversation[]>;
  getConversation(id: number): Promise<Conversation | undefined>;
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  deleteConversation(id: number): Promise<void>;

  // Messages
  getMessages(conversationId: number): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;

  // Knowledge Base (RAG)
  getKnowledgeBaseItems(): Promise<KnowledgeBase[]>;
  searchKnowledgeBase(query: string): Promise<KnowledgeBase[]>;

  // Message audio cache (voice output)
  getMessage(id: number): Promise<Message | undefined>;
  getMessageAudio(messageId: number): Promise<MessageAudio | undefined>;
  saveMessageAudio(messageId: number, audioBase64: string, charCount: number): Promise<void>;
  getMonthlyAudioChars(monthStart: Date): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getConversations(visitorId: string): Promise<Conversation[]> {
    return await db
      .select()
      .from(conversations)
      .where(eq(conversations.visitorId, visitorId))
      .orderBy(desc(conversations.createdAt));
  }

  // Atomically admit a question for a visitor. Runs in a transaction holding
  // a per-visitor advisory lock in the SHARED database, so parallel serverless
  // invocations cannot slip past the cap together, and a retry of an
  // unanswered question always reuses the same record.
  //
  // Cap accounting: only 'answered' questions and still-active 'pending'
  // (in-flight, younger than pendingSince) questions count. 'failed' and
  // stale 'pending' (crashed/aborted invocation) questions stay visible in
  // history but are free - the check is query-time, so no sweeper job or
  // boot-time UPDATE is needed on any database.
  async admitQuestion(args: {
    visitorId: string;
    conversationId: number;
    text: string;
    cap: number;
    windowSince: Date;
    pendingSince: Date;
  }): Promise<{ outcome: "admitted" | "cap_reached" | "in_flight"; messageId: number }> {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${args.visitorId}, 0))`);

      const convoUserMsgs = await tx
        .select({ id: messages.id, content: messages.content, status: messages.status, createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.conversationId, args.conversationId), eq(messages.role, "user")))
        .orderBy(desc(messages.id));

      const retry = convoUserMsgs.find(
        (m) => m.content === args.text && (m.status === "failed" || m.status === "pending")
      );
      if (
        retry &&
        retry.status === "pending" &&
        retry.createdAt &&
        retry.createdAt >= args.pendingSince
      ) {
        // Same question is actively being answered in another invocation.
        return { outcome: "in_flight", messageId: retry.id };
      }

      let used = 0;
      if (args.cap > 0) {
        const rows = await tx
          .select({ id: messages.id })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .where(
            and(
              eq(conversations.visitorId, args.visitorId),
              eq(messages.role, "user"),
              gte(messages.createdAt, args.windowSince),
              or(
                eq(messages.status, "answered"),
                and(eq(messages.status, "pending"), gte(messages.createdAt, args.pendingSince))
              )
            )
          );
        used = rows.length;
      }

      if (args.cap > 0 && used >= args.cap) {
        // Rejected questions stay visible, marked failed - never silently dropped.
        if (retry) {
          await tx.update(messages).set({ status: "failed" }).where(eq(messages.id, retry.id));
          return { outcome: "cap_reached", messageId: retry.id };
        }
        const saved = await tx
          .insert(messages)
          .values({ conversationId: args.conversationId, role: "user", content: args.text, status: "failed" })
          .returning();
        return { outcome: "cap_reached", messageId: saved[0].id };
      }

      if (retry) {
        await tx.update(messages).set({ status: "pending" }).where(eq(messages.id, retry.id));
        return { outcome: "admitted", messageId: retry.id };
      }
      const saved = await tx
        .insert(messages)
        .values({ conversationId: args.conversationId, role: "user", content: args.text, status: "pending" })
        .returning();
      return { outcome: "admitted", messageId: saved[0].id };
    });
  }

  async setMessageStatus(id: number, status: "pending" | "answered" | "failed"): Promise<void> {
    await db.update(messages).set({ status }).where(eq(messages.id, id));
  }

  // Server-issued visitor tokens: only tokens present in the table are
  // honored, so a forged cookie value can never open someone's namespace.
  async visitorTokenExists(token: string): Promise<boolean> {
    const rows = await db.select({ id: visitors.id }).from(visitors).where(eq(visitors.id, token));
    return rows.length > 0;
  }

  async createVisitorToken(token: string): Promise<void> {
    await db.insert(visitors).values({ id: token }).onConflictDoNothing();
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    const [convo] = await db.select().from(conversations).where(eq(conversations.id, id));
    return convo;
  }

  async createConversation(conversation: InsertConversation): Promise<Conversation> {
    const [created] = await db.insert(conversations).values(conversation).returning();
    return created;
  }

  async deleteConversation(id: number): Promise<void> {
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getMessages(conversationId: number): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [created] = await db.insert(messages).values(message).returning();
    return created;
  }

  async getKnowledgeBaseItems(): Promise<KnowledgeBase[]> {
    return await db.select().from(knowledgeBase);
  }


  async searchKnowledgeBase(query: string): Promise<KnowledgeBase[]> {
    // Simple full-text search - fast, no embeddings (see README: low-latency RAG choice)
    const words = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);

    if (words.length === 0) return [];

    return await db
      .select()
      .from(knowledgeBase)
      .where(
        or(
          ...words.flatMap((w) => [
            ilike(knowledgeBase.title, `%${w}%`),
            ilike(knowledgeBase.content, `%${w}%`),
          ])
        )
      )
      .limit(3);
  }

  async getMessage(id: number): Promise<Message | undefined> {
    const [msg] = await db.select().from(messages).where(eq(messages.id, id));
    return msg;
  }

  async getMessageAudio(messageId: number): Promise<MessageAudio | undefined> {
    const [row] = await db.select().from(messageAudio).where(eq(messageAudio.messageId, messageId));
    return row;
  }

  async saveMessageAudio(messageId: number, audioBase64: string, charCount: number): Promise<void> {
    await db.insert(messageAudio).values({ messageId, audioBase64, charCount });
  }

  async getMonthlyAudioChars(monthStart: Date): Promise<number> {
    const rows = await db
      .select({ charCount: messageAudio.charCount })
      .from(messageAudio)
      .where(gte(messageAudio.createdAt, monthStart));
    // Sum in JS for driver simplicity (pglite + pg both fine at this scale)
    return rows.reduce((sum, r) => sum + (r.charCount || 0), 0);
  }
}

export const storage = new DatabaseStorage();
