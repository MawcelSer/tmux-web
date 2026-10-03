#!/usr/bin/env node
/**
 * Shared utilities for Claude Code scripts
 *
 * Cross-platform (Windows, macOS, Linux)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get the Claude config directory
 */
function getClaudeDir() {
  return path.join(os.homedir(), '.claude');
}

/**
 * Get the sessions directory
 */
function getSessionsDir() {
  return path.join(getClaudeDir(), 'sessions');
}

/**
 * Get the learned skills directory
 */
function getLearnedSkillsDir() {
  return path.join(getClaudeDir(), 'learned-skills');
}

/**
 * Get the temp directory for Claude scripts
 */
function getTempDir() {
  const dir = path.join(os.tmpdir(), 'claude-code');
  ensureDir(dir);
  return dir;
}

/**
 * Ensure a directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read a file safely, returns null if not found
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write a file safely, creating directories as needed
 */
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Count regex matches in a file
 */
function countInFile(filePath, regex) {
  const content = readFile(filePath);
  if (!content) return 0;
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Log a message to stderr (doesn't interfere with stdout)
 */
function log(message) {
  console.error(message);
}

/**
 * Get the project root directory (walks up to find package.json or .git)
 */
function getProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json')) ||
        fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

module.exports = {
  getClaudeDir,
  getSessionsDir,
  getLearnedSkillsDir,
  getTempDir,
  ensureDir,
  readFile,
  writeFile,
  countInFile,
  log,
  getProjectRoot
};
