import { randomBytes } from "crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import { registerRoutes } from "./routes.js";
import { storage } from "./storage.js";

// Anonymous visitor identity for the public demo: the server sets an
// HttpOnly cookie (not readable from page JS) holding an opaque random
// token, and every conversation belongs to the visitor that created it.
// This isolates each browser's chat history from other visitors. It is
// NOT authentication: no login is asked, and possession of a cookie value
// is all it proves - treat every public conversation as non-confidential.
//
// Tokens are only honored if the server issued them (they must exist in
// the visitors table): a client that invents or copies an arbitrary value
// gets a fresh empty namespace, never someone else's history.
async function visitorCookie(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.headers.cookie ?? "";
    const jar = Object.fromEntries(
      raw.split(";").map((c) => {
        const i = c.indexOf("=");
        return i === -1 ? [c.trim(), ""] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
      })
    );
    let vid = jar["hk_visitor"];
    const formatOk = !!vid && /^[0-9a-f]{64}$/i.test(vid);
    if (!formatOk || !(await storage.visitorTokenExists(vid))) {
      vid = randomBytes(32).toString("hex");
      await storage.createVisitorToken(vid);
      res.setHeader(
        "Set-Cookie",
        `hk_visitor=${vid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
      );
    }
    (req as Request & { visitorId?: string }).visitorId = vid;
    next();
  } catch (err) {
    next(err);
  }
}

export function visitorIdOf(req: Request): string {
  return (req as Request & { visitorId?: string }).visitorId ?? "";
}

// Shared app factory. Locally, server/index.ts adds static/vite serving and
// listens on a port. On Vercel, api/index.ts uses the same app as a
// serverless function and Vercel serves the static frontend itself.

let appPromise: Promise<Express> | null = null;

export function createApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      const app = express();
      app.use(express.json({ limit: "10mb" }));
      app.use("/api", visitorCookie);
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
