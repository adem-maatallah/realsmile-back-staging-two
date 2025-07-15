const redisClient = require("./redis");

redisClient.on("error", (err) => console.error("Redis error:", err));

const queueImageGeneration = async (jobOptions) => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  await redisClient.rPush("imageGenerationQueue", JSON.stringify(jobOptions));
  console.log(
    `Image generation job added to queue for case ${jobOptions.caseId}`
  );
};

module.exports = queueImageGeneration;
