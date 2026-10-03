const VALID_NAME_RE = /^[\w\-. ]+$/;

export const MAX_COLS = 500;
export const MAX_ROWS = 200;

/** tmux session names: word chars, dash, dot, space. Rejects ':' targets. */
export function isValidName(name) {
  return (
    typeof name === "string" && name.length > 0 && VALID_NAME_RE.test(name)
  );
}

export function isValidWindowIndex(idx) {
  return Number.isInteger(idx) && idx >= 0;
}

export function isValidSize(cols, rows) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols > 0 &&
    cols <= MAX_COLS &&
    rows > 0 &&
    rows <= MAX_ROWS
  );
}

/**
 * Browsers do not apply CORS to WebSockets, so without this check any web
 * page open in the user's browser could drive a shell on this machine
 * (cross-site WebSocket hijacking). Requests without an Origin header come
 * from non-browser clients, which a web page cannot impersonate.
 *
 * @param {string | undefined} origin - Origin header of the upgrade request
 * @param {import("node:http").IncomingMessage} req
 * @param {string[]} allowedOrigins - extra origins, e.g. a reverse proxy URL
 */
export function isAllowedOrigin(origin, req, allowedOrigins = []) {
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (allowedOrigins.includes(parsed.origin)) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return parsed.host === host;
}
