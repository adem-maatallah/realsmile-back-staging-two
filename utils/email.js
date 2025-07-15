const nodemailer = require("nodemailer");
const handlebars = require("handlebars");
const fs = require("fs");
const Queue = require("bull");
const logger = require("./logger");
const { redisUrl } = require("./redis");

// Create a new queue for emails using the same Redis config
const emailQueue = new Queue("emailQueue", {
  redis: {
    host: process.env.REDIS_HOST, // or your Redis host
    port: 6379,
    password: process.env.REDIS_PASSWORD, // if any
  },
});

// Function to add an email job to the queue
const queueEmail = async (options) => {
  await emailQueue.add(options);
  logger.info(`Email job added to queue for ${options.emails}`);
};

// Process the email queue
emailQueue.process(async (job) => {
  logger.info("Processing email queue");
  const transporter = nodemailer.createTransport({
    host: "live.smtp.mailtrap.io",
    port: 587,
    auth: {
      user: "api",
      pass: "ce90c782843bf46e4af500a1cee552cf",
    },
  });

  const templateHtml = fs.readFileSync(job.data.templatePath, "utf-8");
  const template = handlebars.compile(templateHtml);
  const html = template(job.data.templateData);

  for (const email of job.data.emails) {
    const mailOptions = {
      from: '"Real Smile Aligners" <noreply@realsmilealigner.com>',
      to: email,
      subject: job.data.subject,
      html: html,
    };
    try {
      logger.info(`Sending email to ${email}`);
      await transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${email}`);
    } catch (error) {
      logger.error(`Failed to send email to ${email}:`, error);
    }
  }
});

module.exports = queueEmail;
