#!/usr/bin/env node

// Force production mode BEFORE loading .env so it cannot be overridden
process.env.NODE_ENV = 'production';

// Load environment variables from project root
require('dotenv').config({ path: '/opt/content-forge/.env' });

// Run the TypeScript server with tsx
const { spawn } = require('child_process');
const server = spawn('npx', ['tsx', 'src/server/index.ts'], {
  cwd: '/opt/content-forge/apps/hub-web',
  stdio: 'inherit',
  env: process.env,
});

server.on('exit', (code) => {
  console.error(`[start-server] Server exited with code ${code}`);
  process.exit(code || 0);
});
