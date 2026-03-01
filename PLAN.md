# TmuxWeb — Refined Implementation Plan

## Overview
Mobile-first web client for controlling tmux sessions on a remote VPS via a browser.
No authentication layer (Tailscale handles network security).

## Architecture

```
Android/Mobile Browser
     │ WebSocket (binary frames)
     ▼
Node.js Server (port 3000)
     │
     ├── GET /api/sessions       → parsed tmux ls
     ├── GET /api/windows/:sess  → parsed tmux list-windows -t <sess>
     ├── GET /                   → serves Vite-built SPA
     │
     └── WebSocket /ws?session=<name>
           │ spawns: node-pty → tmux attach -t <session>
           │ binary frames: browser ↔ PTY (full duplex)
           ▼
         tmux daemon
```

## Stack

| Layer              | Choice                                         |
| ------------------ | ---------------------------------------------- |
| Runtime            | Node.js 20+                                    |
| PTY bridge         | Python pty module (via helper script)            |
| WebSocket          | ws                                             |
| HTTP               | Node built-in http                             |
| Frontend terminal  | xterm.js 5 + fit + web-links + search addons   |
| Bundler            | Vite                                           |
| Styling            | Plain CSS (mobile-first)                       |
| Test runner        | Vitest                                         |

## Directory Structure

```
tmuxweb/
├── package.json
├── vite.config.js
├── vitest.config.js
├── server/
│   ├── index.js            # entry point — starts HTTP+WS server
│   ├── ws-server.js        # creates HTTP server, mounts WS + REST
│   ├── pty-manager.js      # spawn / write / resize / kill PTY
│   ├── pty-bridge.py       # Python PTY helper (allocates real PTY)
│   └── tmux-api.js         # exec tmux commands, parse output
├── src/
│   ├── index.html
│   ├── main.js
│   ├── terminal.js         # xterm.js init + WS wiring
│   ├── toolbar.js          # mobile key toolbar
│   ├── session-switcher.js # session/window panel
│   ├── font-size.js        # font size A-/A+ with localStorage
│   └── style.css
└── test/
    ├── tmux-api.test.js
    ├── pty-manager.test.js
    ├── ws-server.test.js
    ├── font-size.test.js
    └── toolbar.test.js
```

## Acceptance Criteria

### AC-1: tmux API parsing
- [ ] `parseSessions(stdout)` correctly parses `tmux ls` output into `[{name, windows, created, attached}]`
- [ ] Returns empty array for "no server running" error output
- [ ] Handles sessions with spaces/special chars in names
- [ ] `parseWindows(stdout)` parses `tmux list-windows` into `[{index, name, active, flags}]`
- [ ] Returns empty array on error/empty input
- [ ] `listSessions()` execs `tmux ls` and returns parsed result
- [ ] `listWindows(session)` execs `tmux list-windows -t <session>` and returns parsed result

### AC-2: PTY manager
- [ ] `createPty(sessionName, cols, rows)` spawns Python pty-bridge with `tmux attach -t <session>`
- [ ] Returns an object with `write(data)`, `resize(cols, rows)`, `kill()`, `onData(cb)`
- [ ] `kill()` destroys the child process cleanly
- [ ] `resize()` sends resize command via in-band protocol (`\x00R` + 4 bytes)
- [ ] Handles missing session name by falling back to `tmux attach` (most recent)
- [ ] PTY spawn uses sensible defaults: TERM=xterm-256color, utf-8
- [ ] Python bridge allocates a real PTY via `pty.openpty()` and supports SIGWINCH resize

### AC-3: HTTP REST API
- [ ] `GET /api/sessions` returns JSON `{sessions: [...]}` with 200
- [ ] `GET /api/sessions` returns `{sessions: []}` when tmux has no sessions
- [ ] `GET /api/windows/:session` returns JSON `{windows: [...]}` with 200
- [ ] `GET /api/windows/:session` returns 404 with error when session not found
- [ ] `GET /` serves the built frontend (index.html)
- [ ] Static files under `/assets/` served correctly
- [ ] Unknown routes return 404

### AC-4: WebSocket server
- [ ] Accepts connections on `ws://host:3000/ws?session=<name>`
- [ ] On connect: spawns PTY attached to the requested tmux session
- [ ] Forwards PTY stdout → WebSocket (binary)
- [ ] Forwards WebSocket messages → PTY stdin
- [ ] Handles `resize` JSON messages: `{"type":"resize","cols":N,"rows":N}`
- [ ] On WebSocket close: kills PTY
- [ ] On PTY exit: closes WebSocket with reason

### AC-5: Frontend — Terminal
- [ ] xterm.js terminal renders in the main area, filling available space
- [ ] xterm-addon-fit resizes terminal on window resize / orientation change
- [ ] xterm-addon-web-links makes URLs clickable
- [ ] xterm-addon-search available (Ctrl+Shift+F or toolbar)
- [ ] WebSocket binary frames displayed correctly (ANSI colors, 256 color)
- [ ] Keyboard input forwarded to WebSocket
- [ ] Scrollback buffer: 5000 lines
- [ ] TERM=xterm-256color negotiated

### AC-6: Frontend — Mobile Toolbar
- [ ] Sticky bottom toolbar always visible above virtual keyboard
- [ ] Toolbar buttons: Ctrl+b, Esc, Tab, Arrow keys (←↑↓→), PgUp, PgDn, Ctrl+C, Ctrl+D, Ctrl+Z
- [ ] Tapping a button sends the correct escape sequence to the terminal
- [ ] Ctrl+b enters "prefix mode" — visual indicator shown, next key tap sends prefix + key
- [ ] Post-prefix keys shown: % " d n p [ ] (split, detach, nav, scroll)
- [ ] Font size A-/A+ buttons visible
- [ ] Buttons have adequate touch targets (min 44x44 CSS px)

### AC-7: Frontend — Font Size
- [ ] Default font size: 14px
- [ ] A- decreases by 1px (minimum 8px)
- [ ] A+ increases by 1px (maximum 28px)
- [ ] Font size persisted to localStorage key `tmuxweb:fontSize`
- [ ] On load, font size restored from localStorage
- [ ] Changing font size triggers xterm fit addon reflow

### AC-8: Frontend — Session/Window Switcher
- [ ] Top bar shows current session name
- [ ] Tapping "Sessions" opens a panel listing all tmux sessions
- [ ] Each session shows window count and attached status
- [ ] Tapping a session shows its windows
- [ ] Tapping a window sends `tmux switch-client -t <session>:<window>` via PTY
- [ ] Panel is closable / collapsible
- [ ] Session list refreshed on panel open (fetches /api/sessions)

### AC-9: Responsive / Mobile-first Layout
- [ ] Layout works on 360px-wide screens (small Android phones)
- [ ] No horizontal scroll on mobile
- [ ] Terminal area uses all available vertical space between top bar and toolbar
- [ ] Orientation change handled gracefully (fit addon reflows)
- [ ] Touch scrolling within terminal works (xterm handles it)
- [ ] Pinch-to-zoom disabled at viewport level (meta viewport)

## TDD Strategy

1. Write failing tests first for each module
2. Implement minimum code to pass tests
3. Refactor if needed
4. Commit at each green phase: `test → implement → commit`

Test approach per layer:
- **tmux-api.js**: Pure function tests with mocked stdout strings
- **pty-manager.js**: Mock node-pty, verify spawn args, lifecycle calls
- **ws-server.js**: Spin up real server, connect with ws client, verify message flow
- **font-size.js**: Mock localStorage, verify persistence and bounds
- **toolbar.js**: Verify key-to-escape-sequence mapping correctness
