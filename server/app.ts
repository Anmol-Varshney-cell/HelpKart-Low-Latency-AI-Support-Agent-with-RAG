import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { registerRoutes } from "./routes";

// Shared app factory. Locally, server/index.ts adds static/vite serving and
// listens on a port. On Vercel, api/index.ts uses the same app as a
// serverless function and Vercel serves the static frontend itself.

let appPromise: Promise<Express> | null = null;

export function createApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = express();
      app.use(express.json({ limit: "10mb" }));
      const server: Server = createServer(app);
      await registerRoutes(server, app);
      return app;
    })();
    appPromise.catch(() => {
      appPromise = null; // allow retry on next invocation after a failure
    });
  }
  return appPromise;
}
