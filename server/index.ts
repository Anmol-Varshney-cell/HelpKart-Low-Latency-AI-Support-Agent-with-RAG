import path from "path";
import fs from "fs";
import { createApp } from "./app";

// Local entrypoint: one command serves UI + API (npm run dev / npm start).
// On Vercel this file is unused - api/index.ts is the entry instead.

const isProd = process.env.NODE_ENV === "production";

async function main() {
  const app = await createApp();

  if (isProd) {
    const dist = path.resolve(process.cwd(), "dist", "public");
    if (fs.existsSync(dist)) {
      const { default: express } = await import("express");
      app.use(express.static(dist));
      app.use((_req, res) => res.sendFile(path.join(dist, "index.html")));
    }
  } else {
    const { createServer } = await import("http");
    const { setupVite } = await import("./vite");
    const server = createServer(app);
    await setupVite(app, server);
    const port = Number(process.env.PORT || 5000);
    server.listen(port, () => {
      console.log(`HelpKart dev server on http://localhost:${port}`);
    });
    return;
  }

  const port = Number(process.env.PORT || 5000);
  app.listen(port, () => {
    console.log(`HelpKart server listening on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
