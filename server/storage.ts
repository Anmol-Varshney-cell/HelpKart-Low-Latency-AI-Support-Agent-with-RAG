import { eq, or, ilike, desc, gte } from "drizzle-orm";
import { db } from "./db";
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
} from "../shared/schema";

export interface IStorage {
  // Conversations
  getConversations(): Promise<Conversation[]>;
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
  async getConversations(): Promise<Conversation[]> {
    return await db.select().from(conversations).orderBy(desc(conversations.createdAt));
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
