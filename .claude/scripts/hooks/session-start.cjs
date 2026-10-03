#!/usr/bin/env node
/**
 * Session Start Hook
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Loads previous session context and detects the package manager on new sessions.
 */

const path = require('path');
const {
  getSessionsDir,
  ensureDir,
  readFile,
  log
} = require('../lib/utils.cjs');
const { detectPackageManager } = require('../lib/package-manager.cjs');

async function main() {
  const sessionsDir = getSessionsDir();
  ensureDir(sessionsDir);

  // Load most recent session state if available
  const sessionId = process.env.CLAUDE_SESSION_ID || 'default';
  const stateFile = path.join(sessionsDir, `${sessionId}.json`);
  const state = readFile(stateFile);

  if (state) {
    try {
      const parsed = JSON.parse(state);
      log(`[SessionStart] Loaded previous session state: ${parsed.title || sessionId}`);
      if (parsed.todos && parsed.todos.length > 0) {
        log(`[SessionStart] Pending tasks: ${parsed.todos.filter(t => t.status !== 'completed').length}`);
      }
    } catch {
      log('[SessionStart] Previous session state found but could not be parsed');
    }
  }

  // Detect package manager
  const pm = detectPackageManager();
  log(`[SessionStart] Package manager: ${pm.packageManager} (via ${pm.source})`);

  process.exit(0);
}

main().catch(err => {
  console.error('[SessionStart] Error:', err.message);
  process.exit(0);
});
