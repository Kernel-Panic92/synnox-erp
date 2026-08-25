module.exports = {
  apps: [
    {
      name: 'crm',
      script: './backend/server.js',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3008
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3008
      },
      error_file: './logs/crm-error.log',
      out_file: './logs/crm-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};
