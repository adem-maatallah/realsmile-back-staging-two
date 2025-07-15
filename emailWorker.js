require('dotenv').config();

const Queue = require("bull");
const sendEmail = require("./utils/email");

// Create a new queue (the same one used in your server)
const emailQueue = new Queue("emailQueue", {
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
  },
});

// Process email queue
emailQueue.process(async (job) => {
  console.log("Processing email queue");

  try {
    await sendEmail(job.data);
    console.log(`Email sent to ${job.data.emails.join(", ")}`);
  } catch (error) {
    console.log(`Failed to send email: ${error}`);
  }
});

console.log("Email worker started and waiting for jobs...");
