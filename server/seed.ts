import { db } from "./db.js";
import { knowledgeBase } from "../shared/schema.js";

// Sample HelpKart knowledge base for the RAG demo.
// Replace with real support content before using with real customers.
const SAMPLE_KB = [
  {
    title: "Return policy",
    content:
      "HelpKart allows returns within 30 days of delivery. Items must be in original condition " +
      "with tags and packaging intact. Refunds are issued to the original payment method within " +
      "5-7 business days after the returned item is received.",
  },
  {
    title: "Shipping times",
    content:
      "Standard shipping takes 3-5 business days and is free on orders above Rs 499. " +
      "Express shipping takes 1-2 business days for a flat fee of Rs 99. " +
      "Orders placed before 5 PM ship the same day.",
  },
  {
    title: "Order tracking",
    content:
      "Once an order ships, a tracking link is sent by SMS and email. Customers can also track " +
      "orders from the My Orders section of their HelpKart account. Tracking updates may take " +
      "up to 24 hours to appear after dispatch.",
  },
  {
    title: "Cancel an order",
    content:
      "Orders can be cancelled free of charge within 12 hours of placing them, or until they " +
      "are packed, whichever comes first. After dispatch, the order can be refused at delivery " +
      "or returned under the 30-day return policy.",
  },
  {
    title: "Payment methods",
    content:
      "HelpKart accepts UPI, credit and debit cards, net banking, and cash on delivery (COD) " +
      "on eligible orders. COD is available for orders up to Rs 5,000.",
  },
  {
    title: "Support hours",
    content:
      "Human support agents are available Monday to Saturday, 9 AM to 9 PM IST, via chat and " +
      "email at support@helpkart.example. The AI assistant answers common questions 24/7.",
  },
];

export async function seedDatabase(): Promise<void> {
  const existing = await db.select().from(knowledgeBase).limit(1);
  if (existing.length > 0) return;

  await db.insert(knowledgeBase).values(SAMPLE_KB);
  console.log(`[seed] inserted ${SAMPLE_KB.length} sample knowledge base entries`);
}
