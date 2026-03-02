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
           │ spawns: Python pty-bridge → tmux attach -t <session>
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
    ├── ws-validation.test.js
    ├── session-switcher.test.js
    ├── font-size.test.js
    └── toolbar.test.js
```

## Acceptance Criteria

### AC-1: tmux API parsing
- [x] `parseSessions(stdout)` correctly parses `tmux ls` output into `[{name, windows, created, attached}]`
- [x] Returns empty array for "no server running" error output
- [x] Handles sessions with spaces/special chars in names
- [x] `parseWindows(stdout)` parses `tmux list-windows` into `[{index, name, active, flags}]`
- [x] Returns empty array on error/empty input
- [x] `listSessions()` execs `tmux ls` and returns parsed result
- [x] `listWindows(session)` execs `tmux list-windows -t <session>` and returns parsed result

### AC-2: PTY manager
- [x] `createPty(sessionName, cols, rows)` spawns Python pty-bridge with `tmux attach -t <session>`
- [x] Returns an object with `write(data)`, `resize(cols, rows)`, `kill()`, `onData(cb)`
- [x] `kill()` destroys the child process cleanly
- [x] `resize()` sends resize command via in-band protocol (`\x00R` + 4 bytes)
- [x] Handles missing session name by falling back to `tmux attach` (most recent)
- [x] PTY spawn uses sensible defaults: TERM=xterm-256color, utf-8
- [x] Python bridge allocates a real PTY via `pty.openpty()` and supports SIGWINCH resize
- [x] Spawn errors logged to console

### AC-3: HTTP REST API
- [x] `GET /api/sessions` returns JSON `{sessions: [...]}` with 200
- [x] `GET /api/sessions` returns `{sessions: []}` when tmux has no sessions
- [x] `GET /api/windows/:session` returns JSON `{windows: [...]}` with 200
- [x] `GET /api/windows/:session` returns 404 with error when session not found
- [x] `GET /` serves the built frontend (index.html)
- [x] Static files under `/assets/` served correctly
- [x] Unknown routes return 404
- [x] HTTP method guards (GET only, 405 for others)

### AC-4: WebSocket server
- [x] Accepts connections on `ws://host:3000/ws?session=<name>`
- [x] On connect: spawns PTY attached to the requested tmux session
- [x] Forwards PTY stdout → WebSocket (binary)
- [x] Forwards WebSocket messages → PTY stdin
- [x] Handles `resize` JSON messages: `{"type":"resize","cols":N,"rows":N}` with bounded validation (1-500 cols, 1-200 rows)
- [x] Handles `switch` JSON messages: `{"type":"switch","session":"name","window":N}`
- [x] Handles `new-window` JSON messages: `{"type":"new-window","session":"name"}`
- [x] Handles `new-session` JSON messages: `{"type":"new-session","name":"name"}`
- [x] Handles `kill-session` JSON messages: `{"type":"kill-session","name":"name"}`
- [x] Handles `kill-window` JSON messages: `{"type":"kill-window","session":"name","window":N}`
- [x] On WebSocket close: kills PTY
- [x] On PTY exit: closes WebSocket with reason
- [x] Input validation on session names and window indices
- [x] PTY output buffer capped at 1MB to prevent OOM
- [x] Sanitized error messages (no raw tmux output leaked)

### AC-5: Frontend — Terminal
- [x] xterm.js terminal renders in the main area, filling available space
- [x] xterm-addon-fit resizes terminal on window resize / orientation change
- [x] xterm-addon-web-links makes URLs clickable
- [x] xterm-addon-search available (Ctrl+Shift+F or toolbar)
- [x] WebSocket binary frames displayed correctly (ANSI colors, 256 color)
- [x] Keyboard input forwarded to WebSocket
- [x] Scrollback buffer: 5000 lines
- [x] TERM=xterm-256color negotiated
- [x] SwiftKey composition double-fire patched (prefix/suffix diff with 15ms debounce)
- [x] Mobile keyboard starts in lowercase mode (`autocapitalize="none"`)
- [x] Auto-reconnect with exponential backoff and visibility-change detection

### AC-6: Frontend — Mobile Toolbar
- [x] Sticky bottom toolbar always visible above virtual keyboard
- [x] Toolbar buttons: Ctrl, Alt modifiers, Esc, Tab, Arrow keys (←↑↓→), PgUp, PgDn
- [x] Tapping a button sends the correct escape sequence to the terminal
- [x] Ctrl/Alt modifier toggles with visual indicator, applied to next keypress
- [x] Font size A-/A+ buttons visible
- [x] Buttons have adequate touch targets with haptic feedback

### AC-7: Frontend — Font Size
- [x] Default font size: 14px
- [x] A- decreases by 1px (minimum 8px)
- [x] A+ increases by 1px (maximum 28px)
- [x] Font size persisted to localStorage key `tmuxweb:fontSize`
- [x] On load, font size restored from localStorage
- [x] Changing font size triggers xterm fit addon reflow
- [x] Pinch-to-zoom gesture (6px–32px range)
- [x] onChange unsubscribe support

### AC-8: Frontend — Session/Window Switcher
- [x] Top bar shows current session name
- [x] Tapping "Sessions" opens a panel listing all tmux sessions
- [x] Each session shows window count and attached status
- [x] Tapping a session shows its windows
- [x] Tapping a window switches via WebSocket `switch` message
- [x] Panel is closable / collapsible
- [x] Session list refreshed on panel open (fetches /api/sessions)
- [x] Create new session with name input
- [x] Create new window within a session
- [x] Long-press session name to reveal kill button
- [x] Long-press window name to reveal kill button
- [x] Horizontal swipe gesture to switch sessions
- [x] XSS-safe rendering (textContent, not innerHTML)

### AC-9: Responsive / Mobile-first Layout
- [x] Layout works on 360px-wide screens (small Android phones)
- [x] No horizontal scroll on mobile
- [x] Terminal area uses all available vertical space between top bar and toolbar
- [x] Orientation change handled gracefully (fit addon reflows)
- [x] Touch scrolling within terminal works (custom scroll gesture via mouse escape sequences)
- [x] Pinch-to-zoom handled via custom gesture (font size 6px–32px)
- [x] PWA-ready with manifest.json and meta tags
- [x] Visual viewport API used for virtual keyboard resize handling

## TDD Strategy

1. Write failing tests first for each module
2. Implement minimum code to pass tests
3. Refactor if needed
4. Commit at each green phase: `test → implement → commit`

Test approach per layer (84 tests total):
- **tmux-api.js**: Pure function tests with mocked stdout strings
- **pty-manager.js**: Mock child_process, verify spawn args, lifecycle calls
- **ws-server.js**: Spin up real server, connect with ws client, verify message flow
- **ws-validation.js**: Input validation, method guards, resize bounds, error sanitization
- **session-switcher.js**: DOM rendering, CRUD operations, XSS safety (jsdom)
- **font-size.js**: Mock localStorage, verify persistence and bounds
- **toolbar.js**: Verify key-to-escape-sequence mapping correctness

Coverage thresholds: 80% lines, functions, branches, statements (enforced in vitest.config.js)
