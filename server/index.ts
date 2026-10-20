import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { registerRoutes } from "./routes";

const app = express();
app.use(express.json({ limit: "10mb" }));

const server = createServer(app);
const isProd = process.env.NODE_ENV === "production";

async function main() {
  await registerRoutes(server, app);

  if (isProd) {
    const dist = path.resolve(process.cwd(), "dist", "public");
    if (fs.existsSync(dist)) {
      app.use(express.static(dist));
      app.use((_req, res) => res.sendFile(path.join(dist, "index.html")));
    }
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  }

  const port = Number(process.env.PORT || 5000);
  server.listen(port, () => {
    console.log(`HelpKart server listening on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
