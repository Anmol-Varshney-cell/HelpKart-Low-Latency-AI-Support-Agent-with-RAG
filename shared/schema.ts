import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Customers - for future CRM integration
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Orders - order records with status tracking
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  status: text("status").notNull(),
  total: text("total"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Knowledge base - content repository for RAG retrieval
export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
});

// Conversations - chat session records
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Messages - individual messages within conversations
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Cached generated speech for assistant messages (base64 mp3)
export const messageAudio = pgTable("message_audio", {
  messageId: integer("message_id").primaryKey(),
  audioBase64: text("audio_base64").notNull(),
  charCount: integer("char_count").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas for validation
export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});
export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});
export const insertKnowledgeBaseSchema = createInsertSchema(knowledgeBase).omit({
  id: true,
});

export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertKnowledgeBase = z.infer<typeof insertKnowledgeBaseSchema>;
export type MessageAudio = typeof messageAudio.$inferSelect;
