module.exports = {
  apps: [
    {
      name: 'tutorial-line-web',
      script: 'npm',
      args: 'run preview -- --port 3000 --host 0.0.0.0',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G'
    },
    {
      name: 'tutorial-line-api',
      script: 'server/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      instances: 2, // Cluster across cores
      exec_mode: 'cluster',
      autorestart: true,
      max_memory_restart: '4G'
    }
  ]
};
