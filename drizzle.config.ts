import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to your environment or .env file.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./shared/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
