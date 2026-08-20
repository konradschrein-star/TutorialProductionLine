/**
 * PM2 Ecosystem Configuration for Hub Web
 *
 * Runs custom Next.js server with pg-listen for real-time events.
 * Single instance (no cluster mode) due to pg-listen singleton.
 */

module.exports = {
  apps: [
    {
      name: 'hub-web',
      cwd: '/opt/content-forge/apps/hub-web',
      script: 'pnpm',
      args: 'start',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
      error_file: '/root/.pm2/logs/hub-web-error.log',
      out_file: '/root/.pm2/logs/hub-web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
    },
  ],
};
