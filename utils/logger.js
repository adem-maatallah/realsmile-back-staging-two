// utils/logger.js
const winston = require("winston");
const { combine, timestamp, json, colorize, simple } = winston.format;
const { LoggingWinston } = require("@google-cloud/logging-winston");
const cls = require("cls-hooked");

// Retrieve (or create) a CLS namespace for the request context.
const session =
  cls.getNamespace("request-session") || cls.createNamespace("request-session");

// Custom format that automatically adds userLocation and userId from the CLS context (if set)
const addUserContext = winston.format((info) => {
  const currentSession = cls.getNamespace("request-session");
  if (currentSession) {
    const location = currentSession.get("userLocation");
    if (location) {
      info.userLocation = location;
    }
    const rawIP = currentSession.get("rawIP");
    if (rawIP) {
      info.rawIP = rawIP;
    }
    const userId = currentSession.get("userId");
    if (userId) {
      info.userId = userId;
    }
  }
  return info;
});

// Create the Winston logger with file transports and a custom JSON format
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    timestamp(),
    addUserContext(), // Automatically injects userLocation and userId
    json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

// In production on Google Cloud, add the Cloud Logging transport.
if (process.env.NODE_ENV === "production") {
  const path = require("path");
  const serviceAccountPath = path.resolve(__dirname, "../service-account.json");
  logger.add(
    new LoggingWinston({
      keyFilename: serviceAccountPath,
      serviceContext: {
        service: process.env.SERVICE_NAME || "my-node-service",
        version: process.env.SERVICE_VERSION || "1.0.0",
      },
    })
  );
}

// In non-production environments, add a console transport with colorized output.
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize(), simple()),
    })
  );
}

module.exports = logger;
