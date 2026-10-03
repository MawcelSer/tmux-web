import { readFile } from "node:fs/promises";
import { join, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidName } from "./validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "dist");

// Fixed base: never trust the Host header when parsing request URLs
export const URL_BASE = "http://localhost";

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function requireGet(req) {
  if (req.method !== "GET") throw new HttpError(405, "Method Not Allowed");
}

function decodeSessionParam(raw) {
  let session;
  try {
    session = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "Bad Request");
  }
  if (!isValidName(session)) throw new HttpError(400, "Invalid session name");
  return session;
}

async function serveStatic(res, pathname) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = resolve(join(DIST_DIR, filePath));

  // Prevent path traversal
  if (!fullPath.startsWith(DIST_DIR + "/") && fullPath !== DIST_DIR) {
    throw new HttpError(403, "Forbidden");
  }

  let content;
  try {
    content = await readFile(fullPath);
  } catch {
    throw new HttpError(404, "Not found");
  }
  const mime = MIME_TYPES[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  res.end(content);
}

async function route(req, res, { listSessionsFn, listWindowsFn }) {
  let pathname;
  try {
    ({ pathname } = new URL(req.url, URL_BASE));
  } catch {
    throw new HttpError(400, "Bad Request");
  }

  if (pathname === "/api/sessions") {
    requireGet(req);
    sendJson(res, 200, { sessions: await listSessionsFn() });
    return;
  }

  const windowsMatch = pathname.match(/^\/api\/windows\/(.+)$/);
  if (windowsMatch) {
    requireGet(req);
    const session = decodeSessionParam(windowsMatch[1]);
    try {
      sendJson(res, 200, { windows: await listWindowsFn(session) });
    } catch {
      throw new HttpError(404, "Session not found");
    }
    return;
  }

  await serveStatic(res, pathname);
}

/**
 * Build the HTTP request handler (REST API + static SPA).
 * Every failure is mapped to a JSON error — an async throw here would
 * otherwise be an unhandled rejection, which crashes Node.
 */
export function createHttpHandler(deps) {
  return async (req, res) => {
    try {
      await route(req, res, deps);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error("HTTP request failed:", req.method, req.url, err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal Server Error" });
      } else {
        res.end();
      }
    }
  };
}
