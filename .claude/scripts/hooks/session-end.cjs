#!/usr/bin/env node
/**
 * Session End Hook
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Persists session state on termination for cross-session memory.
 */

const path = require('path');
const {
  getSessionsDir,
  ensureDir,
  writeFile,
  log
} = require('../lib/utils.cjs');

async function main() {
  const sessionsDir = getSessionsDir();
  ensureDir(sessionsDir);

  const sessionId = process.env.CLAUDE_SESSION_ID || 'default';
  const stateFile = path.join(sessionsDir, `${sessionId}.json`);

  const state = {
    sessionId,
    savedAt: new Date().toISOString(),
    cwd: process.cwd(),
    title: process.env.CLAUDE_SESSION_TITLE || null,
    env: {
      nodeVersion: process.version,
      platform: process.platform
    }
  };

  writeFile(stateFile, JSON.stringify(state, null, 2));
  log(`[SessionEnd] Session state saved: ${stateFile}`);

  process.exit(0);
}

main().catch(err => {
  console.error('[SessionEnd] Error:', err.message);
  process.exit(0);
});
