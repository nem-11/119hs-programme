#!/usr/bin/env node
/**
 * Render runs `npm install` at the repo root. The React app lives in client/ and is
 * gitignored after build — without an explicit build step, production keeps serving
 * a stale client/build from an earlier deploy.
 */
const { execSync } = require('child_process');
const path = require('path');

if (process.env.RENDER !== 'true') return;

const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'client');

console.log('[render-postinstall] Building React client for production…');
execSync('npm install && npm run build', {
  cwd: clientDir,
  stdio: 'inherit',
  env: process.env,
});
