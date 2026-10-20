import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server/app.js";

// Vercel serverless entrypoint: all /api/* requests are rewritten here
// (see vercel.json). The Express app is created once per function instance
// and reused across invocations on the same instance.

const appPromise = createApp();

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const app = await appPromise;
  app(req, res);
}
