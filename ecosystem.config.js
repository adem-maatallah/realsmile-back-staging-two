module.exports = {
  apps: [
    {
      name: "api-server",
      script: "api/index.js", // Path to your server entry point
      cwd: "/opt/realsmile/realsmile-api", // Set your project directory here
      watch: false, // Disable watch in production
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      name: "email-worker",
      script: "emailWorker.js", // Path to your email worker file
      cwd: "/opt/realsmile/realsmile-api", // Set your project directory here
      watch: false,
      env: {
        NODE_ENV: "development",
        // Add other necessary env variables
      },
      env_production: {
        NODE_ENV: "production",
        // Add other necessary env variables
      },
    },
  ],
};
