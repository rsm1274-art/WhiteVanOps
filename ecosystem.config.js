module.exports = {
  apps: [
    {
      name: "whitevanops",
      script: "node_modules\\next\\dist\\bin\\next",
      args: "start",
      cwd: "C:\\Users\\rober\\Desktop\\WhiteVanOps",
      interpreter: "C:\\Program Files\\nodejs\\node.exe",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
