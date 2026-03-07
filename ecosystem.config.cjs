module.exports = {
  apps: [
    {
      name: 'tmuxweb',
      script: './server/index.js',
      cwd: '/home/mawcel/tmuxweb',
      interpreter: 'node',
      env: {
        PORT: '3000',
        NODE_ENV: 'production',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      merge_logs: true,
      out_file: '/home/mawcel/.pm2/logs/tmuxweb-out.log',
      error_file: '/home/mawcel/.pm2/logs/tmuxweb-error.log',
    },
  ],
};
