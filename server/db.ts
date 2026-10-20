import * as schema from "../shared/schema";

// Two ways to run the database:
//
// 1. Real PostgreSQL (recommended, matches the README architecture):
//    set DATABASE_URL to a Postgres connection string (for example a free
//    Neon database: https://neon.tech), then run `npm run db:push` once.
//
// 2. Built-in local database for a quick tryout (no setup):
//    set DATABASE_URL=pglite://local - the app runs an embedded Postgres
//    (PGlite) stored in ./.pglite and creates the tables itself.

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Use a PostgreSQL connection string, or " +
    "pglite://local for a zero-setup local tryout. See .env.example."
  );
}

import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

let db: Db;

if (url.startsWith("pglite://")) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite("./.pglite");
  await client.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL,
      created_at timestamp DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id serial PRIMARY KEY,
      customer_id integer NOT NULL,
      status text NOT NULL,
      total text,
      created_at timestamp DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id serial PRIMARY KEY,
      title text NOT NULL,
      content text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id serial PRIMARY KEY,
      title text NOT NULL,
      created_at timestamp DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS message_audio (
      message_id integer PRIMARY KEY,
      audio_base64 text NOT NULL,
      char_count integer NOT NULL,
      created_at timestamp DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id serial PRIMARY KEY,
      conversation_id integer NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      created_at timestamp DEFAULT now()
    );
  `);
  db = drizzle(client, { schema });
  console.log("[db] using embedded PGlite database (./.pglite)");
} else {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: url });
  db = drizzle(pool, { schema });
}

export { db };
