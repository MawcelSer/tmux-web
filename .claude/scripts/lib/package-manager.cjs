#!/usr/bin/env node
/**
 * Package Manager Detection
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Detection order:
 * 1. Lock files in project root
 * 2. packageManager field in package.json
 * 3. Environment variables
 * 4. Default to npm
 */

const fs = require('fs');
const path = require('path');
const { getProjectRoot, readFile } = require('./utils.cjs');

const LOCK_FILES = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'bun.lockb': 'bun'
};

/**
 * Detect the package manager for the current project
 */
function detectPackageManager() {
  const projectRoot = getProjectRoot();

  // 1. Check lock files
  for (const [lockFile, pm] of Object.entries(LOCK_FILES)) {
    if (fs.existsSync(path.join(projectRoot, lockFile))) {
      return { packageManager: pm, source: 'lockfile', lockfile: lockFile };
    }
  }

  // 2. Check packageManager field in package.json
  const pkgJson = readFile(path.join(projectRoot, 'package.json'));
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson);
      if (pkg.packageManager) {
        const pm = pkg.packageManager.split('@')[0];
        return { packageManager: pm, source: 'package.json', lockfile: null };
      }
    } catch {
      // Invalid package.json, continue
    }
  }

  // 3. Check environment variables
  if (process.env.npm_config_user_agent) {
    const agent = process.env.npm_config_user_agent;
    for (const pm of ['pnpm', 'yarn', 'bun', 'npm']) {
      if (agent.includes(pm)) {
        return { packageManager: pm, source: 'env', lockfile: null };
      }
    }
  }

  // 4. Default to npm
  return { packageManager: 'npm', source: 'default', lockfile: null };
}

/**
 * Get the run command for a package manager
 */
function getRunCommand(pm) {
  const commands = {
    npm: 'npm run',
    pnpm: 'pnpm',
    yarn: 'yarn',
    bun: 'bun run'
  };
  return commands[pm] || 'npm run';
}

/**
 * Get the install command for a package manager
 */
function getInstallCommand(pm) {
  const commands = {
    npm: 'npm install',
    pnpm: 'pnpm install',
    yarn: 'yarn install',
    bun: 'bun install'
  };
  return commands[pm] || 'npm install';
}

module.exports = {
  detectPackageManager,
  getRunCommand,
  getInstallCommand,
  LOCK_FILES
};
