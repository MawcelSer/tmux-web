import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { WebSocketServer } from 'ws';
import { exec } from 'node:child_process';
import { createPty as defaultCreatePty } from './pty-manager.js';
import { listSessions as defaultListSessions, listWindows as defaultListWindows } from './tmux-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

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
    const fullPath = join(DIST_DIR, filePath);

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

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const session = url.searchParams.get('session') || '';

    const pty = createPtyFn({
      session,
      cols: 80,
      rows: 24,
    });

    pty.onData((data) => {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    });

    pty.onExit(() => {
      if (ws.readyState === 1) {
        ws.close(1000, 'PTY exited');
      }
    });

    ws.on('message', (msg) => {
      const str = msg.toString();
      // Check for JSON control messages
      try {
        const parsed = JSON.parse(str);
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          pty.resize(parsed.cols, parsed.rows);
          return;
        }
        if (parsed.type === 'switch') {
          // Use server-side tmux command targeting the specific client TTY
          const tty = pty.getTty();
          const target = parsed.window != null
            ? `${parsed.session}:${parsed.window}`
            : parsed.session;
          if (tty) {
            exec(`tmux switch-client -c '${tty}' -t '${target}'`, () => {});
          }
          return;
        }
        if (parsed.type === 'new-window') {
          // Create a new tmux window in the given session
          exec(`tmux new-window -t '${parsed.session}'`, () => {});
          return;
        }
      } catch {
        // Not JSON, treat as terminal input
      }
      pty.write(str);
    });

    ws.on('close', () => {
      pty.kill();
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
