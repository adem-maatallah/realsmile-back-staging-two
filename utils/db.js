const { PrismaClient } = require("@prisma/client");

let prisma;

if (process.env.NODE_ENV === "production") {
  // In production, always create a new Prisma client
  prisma = new PrismaClient({
    log: ["error"], // Log only errors in production for performance
    errorFormat: "minimal", // You can adjust this for concise error reporting
  });
} else {
  // In development, reuse the Prisma client instance to avoid creating multiple connections
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      log: ["query", "info", "warn", "error"], // More verbose logging for development
      errorFormat: "pretty", // Helpful error reporting in dev
    });
  }
  prisma = global.prisma;
}

module.exports = prisma;
