# TmuxWeb

A mobile-friendly web client for [tmux](https://github.com/tmux/tmux). Access your tmux sessions from any browser with touch-optimized gestures, a virtual toolbar for special keys, and real-time WebSocket streaming.

## Features

- **Full terminal** via [xterm.js](https://xtermjs.org/) with search, web links, and cursor blink
- **Session management** — create, switch, and kill sessions; top bar buttons or horizontal swipe gestures
- **Window management** — create, switch, and kill windows within sessions
- **Long-press to kill** — hold a session or window name to reveal the kill button
- **Touch gestures** — scroll, swipe to switch sessions, pinch to zoom font size
- **Virtual toolbar** — Ctrl/Alt modifiers, arrow keys, Esc, Tab, and common shortcuts with haptic feedback
- **Auto-reconnect** — WebSocket reconnects with exponential backoff and visibility-change detection
- **SwiftKey compatibility** — patched xterm.js composition handler to fix character doubling on Android IME keyboards
- **Lowercase keyboard** — mobile keyboard starts in lowercase mode via `autocapitalize="none"`
- **PWA-ready** — installable as a home screen app on mobile (manifest + meta tags)
- **Responsive** — adapts to portrait, landscape, and narrow screens

## Requirements

- Node.js 18+
- tmux installed and running on the host
- Python 3 (for the PTY bridge)

## Quick Start

```bash
# Install dependencies
npm install

# Build the frontend
npm run build

# Start the server (default port 3000)
npm run dev
```

Then open `http://localhost:3000?session=<your-tmux-session>` in a browser.

## Production

Uses [PM2](https://pm2.keymetrics.io/) for process management:

```bash
npm run build
npm start        # start with pm2
npm run logs     # view logs
npm run restart  # restart
npm run stop     # stop
```

Set the port with the `PORT` environment variable:

```bash
PORT=8080 npm run dev
```

## Touch Gestures

| Gesture | Action |
|---------|--------|
| Tap | Focus terminal / open keyboard / close switcher panel |
| Vertical drag | Scroll through tmux history |
| Horizontal swipe | Switch to next/previous session |
| Pinch | Zoom font size (6px–32px) |
| Long-press session/window | Reveal kill button |

## REST API

| Endpoint | Description |
|----------|-------------|
| `GET /api/sessions` | List all tmux sessions |
| `GET /api/windows/:session` | List windows for a session |

## WebSocket Protocol

Connect to `ws://host:3000/ws?session=<name>`. Plain text messages are forwarded to the PTY. JSON control messages:

| Type | Fields | Description |
|------|--------|-------------|
| `resize` | `cols`, `rows` | Resize the terminal |
| `switch` | `session`, `window?` | Switch tmux client to target |
| `new-window` | `session` | Create a new window |
| `new-session` | `name` | Create a new tmux session |
| `kill-session` | `name` | Kill a tmux session |
| `kill-window` | `session`, `window` | Kill a specific window |

## Project Structure

```
src/
  index.html          # Single-page shell
  main.js             # App entry — wires terminal, toolbar, switcher
  terminal.js         # xterm.js setup, WebSocket, touch gestures, SwiftKey patch
  toolbar.js          # Virtual key toolbar with modifier support
  session-switcher.js # Session/window panel UI with CRUD
  font-size.js        # Font size persistence (localStorage)
  style.css           # All styles
  manifest.json       # PWA manifest
server/
  index.js            # Server entry point
  ws-server.js        # HTTP server, REST API, WebSocket handler
  pty-manager.js      # PTY session lifecycle via Python bridge
  tmux-api.js         # tmux command interface and output parsing
  pty-bridge.py       # Python PTY bridge (allocates real PTY)
test/
  tmux-api.test.js    # tmux output parsing tests
  pty-manager.test.js # PTY lifecycle tests
  ws-server.test.js   # HTTP + WebSocket integration tests
  ws-validation.test.js # Input validation and security tests
  session-switcher.test.js # Switcher UI and XSS safety tests
  font-size.test.js   # Font size persistence tests
  toolbar.test.js     # Key mapping tests
vitest.config.js      # Test configuration with coverage thresholds
```

## Development

```bash
npm run dev          # Start dev server
npm test             # Run tests (84 tests)
npm run test:watch   # Watch mode
```

## License

MIT
