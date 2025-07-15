// cronWorker.js - Standalone worker for running treatment cron jobs
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Setup any required configurations
require("./utils/firebaseConfig");

// Import and initialize cron jobs
require("./controllers/treatmentCronJobs");

console.log("Treatment cron worker started at:", new Date().toISOString());

// Keep the process running
process.on("SIGINT", async () => {
  console.log("Gracefully shutting down cron worker");
  await prisma.$disconnect();
  process.exit(0);
});
