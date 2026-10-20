import type { Express } from "express";
import type { Server } from "http";
import { createServer as createViteServer } from "vite";

// Dev mode: run Vite as middleware inside Express so one command (npm run dev)
// serves the frontend and the API together on port 5000.
export async function setupVite(app: Express, server: Server): Promise<void> {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
