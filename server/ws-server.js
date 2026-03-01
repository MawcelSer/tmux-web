import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { WebSocketServer } from 'ws';
import { execFile } from 'node:child_process';
import { createPty as defaultCreatePty } from './pty-manager.js';
import { listSessions as defaultListSessions, listWindows as defaultListWindows } from './tmux-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(join(__dirname, '..', 'dist'));

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

/**
 * Create and return the HTTP + WebSocket server.
 * All dependencies are injectable for testing.
 */
export function createServer({
  port = 3000,
  listSessionsFn = defaultListSessions,
  listWindowsFn = defaultListWindows,
  createPtyFn = defaultCreatePty,
} = {}) {
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // REST API
    if (pathname === '/api/sessions') {
      const sessions = await listSessionsFn();
      sendJson(res, 200, { sessions });
      return;
    }

    const windowsMatch = pathname.match(/^\/api\/windows\/(.+)$/);
    if (windowsMatch) {
      const session = decodeURIComponent(windowsMatch[1]);
      try {
        const windows = await listWindowsFn(session);
        sendJson(res, 200, { windows });
      } catch (err) {
        sendJson(res, 404, { error: err.message });
      }
      return;
    }

    // Static files from dist/
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const fullPath = resolve(join(DIST_DIR, filePath));

    // Prevent path traversal
    if (!fullPath.startsWith(DIST_DIR + '/') && fullPath !== DIST_DIR) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    try {
      const content = await readFile(fullPath);
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch {
      sendJson(res, 404, { error: 'Not found' });
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const activeSessions = new Map();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const session = url.searchParams.get('session') || '';

    // Kill old PTY bridge for the same session to prevent duplicate clients
    if (session && activeSessions.has(session)) {
      const old = activeSessions.get(session);
      old.pty.kill();
      if (old.ws.readyState <= 1) old.ws.close(1000, 'Replaced by new connection');
      activeSessions.delete(session);
    }

    const pty = createPtyFn({
      session,
      cols: 80,
      rows: 24,
    });

    if (session) activeSessions.set(session, { ws, pty });

    // Coalesce PTY output using setImmediate: batches data from the same
    // event loop tick into one WebSocket send. ~0ms latency for isolated
    // events (keystroke echo), effective batching during bursts (scrolling).
    let sendBuf = [];
    let sendScheduled = false;
    function flushSendBuf() {
      sendScheduled = false;
      if (sendBuf.length && ws.readyState === 1) {
        ws.send(Buffer.concat(sendBuf));
        sendBuf = [];
      }
    }
    pty.onData((data) => {
      if (ws.readyState !== 1) return;
      sendBuf.push(data);
      if (!sendScheduled) {
        sendScheduled = true;
        setImmediate(flushSendBuf);
      }
    });

    pty.onExit(() => {
      if (ws.readyState === 1) {
        ws.close(1000, 'PTY exited');
      }
    });

    ws.on('message', (msg) => {
      const str = msg.toString();
      // Fast path: only attempt JSON parse if message looks like JSON object
      if (str.charCodeAt(0) === 123) { // '{'
        try {
          const parsed = JSON.parse(str);
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            pty.resize(parsed.cols, parsed.rows);
            return;
          }
          if (parsed.type === 'switch') {
            const tty = pty.getTty();
            const target = parsed.window != null
              ? `${parsed.session}:${parsed.window}`
              : parsed.session;
            if (tty) {
              execFile('tmux', ['switch-client', '-c', tty, '-t', target], () => {});
            }
            return;
          }
          if (parsed.type === 'new-window') {
            execFile('tmux', ['new-window', '-t', parsed.session], () => {});
            return;
          }
          if (parsed.type === 'new-session') {
            const name = parsed.name;
            if (!name || !/^[\w\-. ]+$/.test(name)) return;
            execFile('tmux', ['new-session', '-d', '-s', name], () => {});
            return;
          }
          if (parsed.type === 'kill-session') {
            const name = parsed.name;
            if (!name || !/^[\w\-. ]+$/.test(name)) return;
            execFile('tmux', ['kill-session', '-t', name], () => {});
            return;
          }
          if (parsed.type === 'kill-window') {
            const sessionName = parsed.session;
            const winIndex = parsed.window;
            if (!sessionName || !/^[\w\-. ]+$/.test(sessionName)) return;
            if (!Number.isInteger(winIndex) || winIndex < 0) return;
            execFile('tmux', ['kill-window', '-t', `${sessionName}:${winIndex}`], () => {});
            return;
          }
          // Any JSON with a 'type' field is a control message — never forward to terminal
          if (parsed.type) return;
        } catch {
          // Malformed JSON, fall through to treat as terminal input
        }
      }
      pty.write(str);
    });

    ws.on('error', () => {});

    ws.on('close', () => {
      sendBuf = [];
      pty.kill();
      if (session && activeSessions.get(session)?.ws === ws) {
        activeSessions.delete(session);
      }
    });
  });

  httpServer.listen(port);

  return {
    httpServer,
    wss,
    close() {
      return new Promise((resolve) => {
        wss.clients.forEach((ws) => ws.terminate());
        wss.close(() => {
          httpServer.close(resolve);
        });
      });
    },
  };
}
