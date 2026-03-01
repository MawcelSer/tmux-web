# TmuxWeb

A mobile-friendly web client for [tmux](https://github.com/tmux/tmux). Access your tmux sessions from any browser with touch-optimized gestures, a virtual toolbar for special keys, and real-time WebSocket streaming.

## Features

- **Full terminal** via [xterm.js](https://xtermjs.org/) with search, web links, and cursor blink
- **Session & window switching** — top bar buttons or horizontal swipe gestures
- **Touch gestures** — scroll, swipe to switch sessions, pinch to zoom font size
- **Virtual toolbar** — Ctrl/Alt modifiers, arrow keys, Esc, Tab, and common shortcuts with haptic feedback
- **Auto-reconnect** — WebSocket reconnects with exponential backoff
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

## Project Structure

```
src/
  index.html          # Single-page shell
  main.js             # App entry — wires terminal, toolbar, switcher
  terminal.js         # xterm.js setup, WebSocket, touch gestures
  toolbar.js          # Virtual key toolbar with modifier support
  session-switcher.js # Session/window panel UI
  font-size.js        # Font size persistence (localStorage)
  style.css           # All styles
  manifest.json       # PWA manifest
server/
  index.js            # HTTP + WebSocket server entry
  ws-server.js        # WebSocket handler
  pty-manager.js      # PTY session lifecycle
  tmux-api.js         # tmux command interface
  pty-bridge.py       # Python PTY bridge
test/                 # Vitest tests
```

## Development

```bash
npm run dev          # Start dev server
npm test             # Run tests
npm run test:watch   # Watch mode
```

## License

MIT
