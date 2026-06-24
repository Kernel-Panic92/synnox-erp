module.exports = {
  apps: [
    {
      name: 'logistics',
      script: './backend/server.js',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3004
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3004
      },
      error_file: './logs/logistics-error.log',
      out_file: './logs/logistics-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};

/*
Uso:
  - Iniciar:     pm2 start ecosystem.config.cjs
  - Desarrollo:  pm2 start ecosystem.config.cjs --env development
  - Logs:        pm2 logs logistics
  - Monitorear:  pm2 monit
  - Guardar:     pm2 save
  - Startuo:     pm2 startup
*/
