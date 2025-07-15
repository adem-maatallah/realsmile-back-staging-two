const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.REDIS_URL, // Use environment variable for Redis URL
});

redisClient.on("error", (err) => console.log("Redis Client Error", err));

// Ensure the connection is made asynchronously
(async () => {
  try {
    await redisClient.connect();
    console.log("Redis connected");
  } catch (err) {
    console.error("Redis connection error:", err);
  }
})();

module.exports = redisClient;
