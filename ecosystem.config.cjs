module.exports = {
  apps: [
    {
      name: "flashcards-web",
      script: ".next/standalone/server.js",
      cwd: "/home/ubuntu/flashcards-app",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      // boss.stop()/after() do Next precisam de shutdown gracioso (Fase 2+ worker)
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        PORT: 3060,
        HOSTNAME: "127.0.0.1",
      },
    },
    {
      name: "flashcards-worker",
      script: "dist/worker.js",
      // Node puro não carrega .env sozinho (a web usa o loader do Next).
      node_args: "--env-file=.env",
      cwd: "/home/ubuntu/flashcards-app",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      // boss.stop({ wait: true }) precisa terminar antes do SIGKILL.
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        // Orçamento §6.1: worker 2/2 (o .env compartilhado traz 6/2 da web;
        // --env-file NÃO sobrescreve env já presente no processo).
        DATABASE_POOL_MAX_APP: "2",
        DATABASE_POOL_MAX_SERVICE: "2",
      },
    },
  ],
};
