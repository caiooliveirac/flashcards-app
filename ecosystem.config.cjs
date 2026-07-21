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
    // Fase 2 adiciona: flashcards-worker (dist/worker.js, fork, pg-boss supervise)
  ],
};
