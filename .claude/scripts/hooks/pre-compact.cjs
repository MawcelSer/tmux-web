#!/usr/bin/env node
/**
 * Pre-Compact Hook
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Saves current session state before context compaction so nothing important is lost.
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
  const compactFile = path.join(sessionsDir, `${sessionId}-pre-compact.json`);

  const state = {
    sessionId,
    compactedAt: new Date().toISOString(),
    cwd: process.cwd(),
    reason: 'pre-compact save'
  };

  writeFile(compactFile, JSON.stringify(state, null, 2));
  log(`[PreCompact] State saved before compaction: ${compactFile}`);

  process.exit(0);
}

main().catch(err => {
  console.error('[PreCompact] Error:', err.message);
  process.exit(0);
});
