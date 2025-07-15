const asyncHandler = require("express-async-handler");
const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");
const { NotFoundError, BadRequestError } = require("../middlewares/apiError");
const {
  SuccessResponse,
  SuccessMsgResponse,
} = require("../middlewares/apiResponse");
const multer = require("multer");
const fs = require("fs");
const ApiVideoClient = require("@api.video/nodejs-client");
const apivideoClient = new ApiVideoClient({
  apiKey: process.env.API_VIDEO_API_KEY,
});
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const prisma = new PrismaClient().$extends(withAccelerate());
const upload = multer({ dest: "upload" });
const pino = require("pino");
const { sanitizeFilter } = require("mongoose");
const puppeteer = require("puppeteer");
const { patientMessaging } = require("../utils/firebaseConfig");

// your centralized logger object
const logger = pino();
// Basic log statement to test if Pino is working
logger.info("Pino logger is initialized and working");

// Helper function to upload video to API.video
const uploadToApiVideo = async (file, videoName) => {
  const video = await apivideoClient.videos.create({
    title: videoName,
    description: "Uploaded via Node.js",
  });

  const videoId = video.videoId;
  const uploadResponse = await apivideoClient.videos.upload(videoId, file.path);

  // Return the embed link instead of the .m3u8 manifest
  const embedLink = `https://embed.api.video/vod/${videoId}`;
  return embedLink;
};

// get All alerts
exports.getAllAlerts = asyncHandler(async (req, res) => {
  try {
    logger.info("Inside the request for fetching all alerts...");

    // Fetch all alerts with associated patient and doctor details
    const alerts = await prisma.alerts.findMany({
      include: {
        patients: {
          select: {
            id: true,
            user_id: true,
            first_name: true,
            last_name: true,
          },
        },
        doctors: {
          include: {
            user: true,
          },
          // select: {
          //   id: true,
          // },
        },
      },
    });
    //   const cases = await prisma.cases.findMany({
    //     include: {
    //         patients: {
    //             include: {
    //                 users: true,  // Assuming patients are related to users via user_id
    //             },
    //         },
    //         doctors: {
    //             include: {
    //                 users: true,  // Assuming doctors are related to users via user_id
    //             }
    //         }
    //     },
    //     orderBy: {
    //         created_at: 'desc', // Sort by creation date
    //     },
    // });
    logger.info("Fetched alerts from the database:", alerts);

    // Check if any alerts exist
    if (!alerts || alerts.length === 0) {
      console.warn("No alerts found in the database.");
      return res.status(404).json({ error: "No alerts found." });
    }

    logger.info("Processing and serializing alerts for the response...");

    // Serialize alerts for response
    const serializedAlerts = alerts.map((alert) => ({
      id: Number(alert.id),
      title: alert.title,
      description: alert.description,
      video_link: alert.video_link,
      created_at: alert.created_at,
      updated_at: alert.updated_at,
      resolved: alert.resolved,

      patient: alert.patients
        ? {
            id: Number(alert.patients.id),
            user_id: Number(alert.patients.user_id),
            name: `${alert.patients.first_name} ${alert.patients.last_name}`,
          }
        : null,
      doctor: alert.doctors
        ? {
            id: Number(alert.doctors.id),
            user_id: Number(alert.doctors.user_id),
            name:
              alert.doctors.user.first_name && alert.doctors.user.last_name
                ? `${alert.doctors.user.first_name} ${alert.doctors.user.last_name}`
                : "Doctor name not available",
            phone: alert.doctors.user.phone,
          }
        : null,
    }));

    // logger.info("Serialized alerts:", JSON.stringify(serializedAlerts, null, 2));

    // Send the response
    res.status(200).json({
      status: "success",
      data: serializedAlerts,
    });

    logger.info("Response sent successfully.");
  } catch (error) {
    logger.error("Error fetching all alerts:", error.message);
    res
      .status(500)
      .json({ error: "Failed to fetch alerts", details: error.message });
  }
});

// ************************************************Alerts**************************************************
// post alert
exports.createAlert = asyncHandler(async (req, res) => {
  try {
    const { user_id } = req.params;
    const { title, description, video_title, video_description } = req.body;
    const filePath = req.file?.path;

    if (!filePath) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    // Log received data
    logger.info("req.file", req.file);
    logger.info("req.body", {
      video_title,
      video_description,
      description,
      title,
    });

    // Fetch patient details
    const patient = await prisma.patients.findUnique({
      where: { user_id: BigInt(user_id) },
    });

    if (!patient) {
      return res
        .status(404)
        .json({ error: "No patient found with that user id" });
    }
    logger.info("Fetched Patient:", patient);

    const { id: patientId, doctor_id: doctorId } = patient;

    // Step 1: Create a new video object on ApiVideo
    const client = new ApiVideoClient({
      apiKey: process.env.API_VIDEO_API_KEY,
    });

    const video = await client.videos.create({
      title: video_title || "Untitled Video",
      description: video_description || "No description",
    });

    logger.info("Video created with ID:", video.videoId);

    // Step 2: Upload the video file using the created videoId
    await client.videos.upload(video.videoId, filePath, (progress) => {
      logger.info(`Upload progress: ${progress.percentage}%`);
    });

    logger.info("Video uploaded successfully");

    // Step 3: Save alert details in the database
    const alert = await prisma.alerts.create({
      data: {
        patient_id: patientId,
        doctor_id: doctorId,
        title,
        description,
        video_link: video.videoId,
      },
    });

    const serializedAlert = {
      ...alert,
      id: Number(alert.id),
      patient_id: Number(alert.patient_id),
      doctor_id: Number(alert.doctor_id),
    };

    logger.info("Serialized Alert:", serializedAlert);

    res.status(201).json({
      status: "success",
      message: "Alert created successfully.",
      data: serializedAlert,
    });
  } catch (error) {
    logger.error("Error creating alert:", error);
    res
      .status(500)
      .json({ error: "Failed to create alert", details: error.message });
  } finally {
    // Clean up uploaded file
    if (req.file?.path) {
      require("fs").unlinkSync(req.file.path);
    }
  }
});

exports.getAlertsAsDoctor = asyncHandler(async (req, res) => {
  try {
    const { user_id } = req.params;
    const logged_in_user = req.session.userId;
    logger.info("logged_in_user: ", logged_in_user);
    if (user_id != logged_in_user) {
      return res.status(401).json({ error: "Unauthorized Access." });
    }
    // Fetch user details
    const user = await prisma.users.findUnique({
      where: { id: BigInt(user_id) },
      select: { id: true, role_id: true, first_name: true, last_name: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // Check if the user is a doctor
    if (Number(user.role_id) !== 3) {
      return res.status(400).json({ error: "User is not a doctor." });
    }

    // Fetch the doctor's ID
    const doctor = await prisma.doctors.findUnique({
      where: { user_id: BigInt(user.id) },
      select: { id: true },
    });

    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    const doctorId = doctor.id;
    logger.info("doctorId: ", doctorId);
    // Fetch all alerts associated with the doctor and group them by patient
    const alerts = await prisma.alerts.findMany({
      where: { doctor_id: doctorId },
      select: {
        id: true,
        title: true,
        patient_id: true,
        video_link: true,
        description: true,
        created_at: true,
        updated_at: true,
        resolved: true,
        patients: {
          select: {
            first_name: true,
            last_name: true,
            users: {
              select: {
                profile_pic: true,
              },
            },
          },
        },
      },
    });
    logger.info("getting alerts as doctor: ", alerts);
    if (!alerts.length) {
      return res
        .status(404)
        .json({ error: "No alerts found for this doctor." });
    }

    // Group alerts by patient_id
    const groupedAlerts = alerts.reduce((acc, alert) => {
      const patientId = Number(alert.patient_id);
      const patientName = `${alert.patients.first_name} ${alert.patients.last_name}`;
      const patientPic = alert.patients.users.profile_pic;
      if (!acc[patientId]) {
        acc[patientId] = {
          patient_id: patientId,
          patient_name: patientName,
          patient_picture: patientPic,
          alerts: [],
        };
      }

      acc[patientId].alerts.push({
        id: Number(alert.id),
        title: alert.title,
        video_link: alert.video_link,
        description: alert.description,
        created_at: alert.created_at,
        updated_at: alert.updated_at,
        resolved: alert.resolved,
      });

      return acc;
    }, {});

    res.status(200).json({
      status: "success",
      data: Object.values(groupedAlerts), // Convert grouped alerts to an array
    });
  } catch (error) {
    logger.error("Error fetching grouped alerts:", error);
    res.status(500).json({
      error: "Failed to fetch grouped alerts",
      details: error.message,
    });
  }
});
exports.getAlertsForPatient = asyncHandler(async (req, res) => {
  try {
    const { user_id, patient_user_id } = req.params;

    const logged_in_user = req.session.userId;
    logger.info("logged_in_user: ", logged_in_user);

    if (user_id != logged_in_user) {
      return res.status(401).json({ error: "Unauthorized Access." });
    }

    // Fetch the doctor based on the user_id
    const doctor = await prisma.doctors.findUnique({
      where: { user_id: BigInt(user_id) },
      select: { id: true },
    });

    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    const doctorId = doctor.id;
    logger.info("doctorId: ", doctorId);

    // Fetch the patient based on the patient_user_id
    const patient = await prisma.patients.findUnique({
      where: { user_id: BigInt(patient_user_id) },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        user: {
          select: { profile_pic: true },
        },
      },
    });

    if (!patient) {
      return res.status(404).json({ error: "Patient not found." });
    }

    const patientId = patient.id;
    const patientName = `${patient.first_name} ${patient.last_name}`;
    const patientPic = patient.user.profile_pic;

    // Fetch alerts for the specific patient and doctor
    const alerts = await prisma.alerts.findMany({
      where: {
        doctor_id: doctorId,
        patient_id: patientId,
      },
      select: {
        id: true,
        title: true,
        video_link: true,
        description: true,
        created_at: true,
        updated_at: true,
        resolved: true,
      },
    });

    if (!alerts.length) {
      return res
        .status(404)
        .json({ error: "No alerts found for this patient." });
    }

    // Format the response
    const response = {
      patient_id: Number(patientId),
      patient_name: patientName,
      patient_picture: patientPic,
      alerts: alerts.map((alert) => ({
        id: Number(alert.id),
        title: alert.title,
        video_link: alert.video_link,
        description: alert.description,
        created_at: alert.created_at,
        updated_at: alert.updated_at,
        resolved: alert.resolved,
      })),
    };
    logger.info("response: ", response);
    res.status(200).json({
      status: "success",
      data: [response], // Return data in the specified format
    });
  } catch (error) {
    logger.error("Error fetching alerts for patient:", error);
    res.status(500).json({
      error: "Failed to fetch alerts for patient",
      details: error.message,
    });
  }
});

exports.getAlertsAsPatient = asyncHandler(async (req, res) => {
  try {
    const { user_id } = req.params;
    const logged_in_user = req.session.userId;
    logger.info("logged_in_user: ", logged_in_user);
    if (user_id != logged_in_user) {
      return res.status(401).json({ error: "Unauthorized Access." });
    }
    // Fetch user details
    const user = await prisma.users.findUnique({
      where: { id: BigInt(user_id) },
      select: { id: true, role_id: true, first_name: true, last_name: true },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // If the role is 4 (patient)
    if (Number(user.role_id) === 4) {
      // Fetch patient details
      const patient = await prisma.patients.findUnique({
        where: { user_id: BigInt(user.id) },
        select: { id: true, first_name: true, last_name: true },
      });

      if (!patient) {
        return res
          .status(404)
          .json({ error: "No patient found for this user." });
      }

      const patientId = patient.id;

      // Fetch alerts for the patient
      const alerts = await prisma.alerts.findMany({
        where: { patient_id: patientId },
        select: {
          id: true,
          description: true,
          title: true,
          video_link: true,
          created_at: true,
          updated_at: true,
          resolved: true,
        },
      });

      if (!alerts.length) {
        return res.status(404).json({
          status: "error",
          message: "No alerts found for this patient.",
          data: {
            patient_id: Number(patientId),
            patient_name: `${patient?.first_name} ${patient?.last_name}`,
            alerts: [],
          },
        });
      }

      const serializedAlerts = alerts.map((alert) => ({
        ...alert,
        id: Number(alert.id),
      }));

      return res.status(200).json({
        status: "success",
        data: {
          patient_id: Number(patientId),
          patient_name: `${patient?.first_name} ${patient?.last_name}`,
          alerts: serializedAlerts,
        },
      });
    }

    // If the role is not supported
    return res
      .status(400)
      .json({ error: "Unsupported role for this operation." });
  } catch (error) {
    logger.error("Error fetching alerts:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch alerts", details: error.message });
  }
});

// get one alert:
exports.getAlert = asyncHandler(async (req, res) => {
  try {
    const { alert_id } = req.params;

    // // Fetch patient details
    // const patient = await prisma.patients.findUnique({
    //   where: { user_id: BigInt(user_id) },
    // });

    // if (!patient) {
    //   return res.status(404).json({ error: 'No patient found with that user id' });
    // }

    // const { id: patientId } = patient;

    // Fetch alerts for the patient
    const alerts = await prisma.alerts.findUnique({
      where: { id: BigInt(alert_id) },
      select: {
        id: true,
        description: true,
        video_link: true,
        created_at: true,
        updated_at: true,
      },
    });
    logger.info("alerts:", alerts);
    if (!alerts) {
      return res.status(404).json({
        error: "No alert with that alert id is found for this patient.",
      });
    }

    const serializedAlerts = {
      ...alerts,
      id: Number(alerts.id),
    };

    res.status(200).json({
      status: "success",
      data: serializedAlerts,
    });
  } catch (error) {
    logger.error("Error fetching alerts:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch alerts", details: error.message });
  }
});

exports.resolveAlert = asyncHandler(async (req, res) => {
  const { alert_id } = req.params;

  try {
    // Check if the alert exists
    const alert = await prisma.alerts.findUnique({
      where: { id: BigInt(alert_id) },
    });
    logger.info("did you find alert: ", alert);
    if (!alert) {
      return res
        .status(404)
        .json({ status: "fail", message: "Alert not found." });
    }

    // Update the resolved field to true
    const updatedAlert = await prisma.alerts.update({
      where: { id: BigInt(alert_id) },
      data: { resolved: true },
    });
    const serializedAlerts = {
      ...updatedAlert,
      id: Number(updatedAlert.id),
      doctor_id: Number(updatedAlert.doctor_id),
      patient_id: Number(updatedAlert.patient_id),
    };
    res.status(200).json({
      status: "success",
      message: "Alert has been marked as resolved.",
      data: serializedAlerts,
    });
  } catch (error) {
    logger.error("Error resolving alert:", error);
    res.status(500).json({
      status: "fail",
      message: "Failed to resolve alert.",
      error: error.message,
    });
  }
});

// ************************************************Treatments**************************************************
// Get all treatments
exports.getTreatments = asyncHandler(async (req, res) => {
  const treatments = await prisma.treatments.findMany({
    orderBy: {
      start_date: "desc",
    },
  });

  if (!treatments || treatments.length === 0) {
    return new SuccessMsgResponse([]).send(res);
  }

  const treatmentsWithNumericId = treatments.map((treatment) => ({
    ...treatment,
    id: Number(treatment.id),
    case_id: Number(treatment.case_id),
    treatment_number: Number(treatment.treatment_number),
  }));

  return new SuccessResponse(treatmentsWithNumericId).send(res);
});
exports.getUpcomingTreatment = asyncHandler(async (req, res) => {
  const { caseId } = req.params;

  try {
    const upcomingTreatment = await prisma.treatments.findFirst({
      where: {
        case_id: BigInt(caseId), // Ensure caseId is in the correct format
        start_date: {
          gt: new Date(), // Find treatments where start_date is in the future
        },
      },
      orderBy: {
        start_date: "asc", // Get the closest upcoming treatment
      },
      select: {
        id: true,
        treatment_number: true,
        start_date: true,
        end_date: true,
        status: true,
        finalized: true,
        verified: true,
      },
    });

    if (!upcomingTreatment) {
      return res.status(404).json({ message: "No upcoming treatment found." });
    }

    // Calculate the days left until the start date
    const today = new Date();
    const startDate = new Date(upcomingTreatment.start_date);
    const timeDifference = startDate.getTime() - today.getTime();
    const daysLeft = Math.ceil(timeDifference / (1000 * 60 * 60 * 24));

    let daysLeftText;
    if (daysLeft === 0) {
      daysLeftText = "Today";
    } else if (daysLeft === 1) {
      daysLeftText = "Tomorrow";
    } else {
      daysLeftText = `${daysLeft} days left`;
    }

    return res.status(200).json({
      message: "Upcoming treatment found.",
      data: {
        ...upcomingTreatment,
        id: Number(upcomingTreatment.id),
        treatment_number: Number(upcomingTreatment.treatment_number),
        daysLeft,
        daysLeftText,
      },
    });
  } catch (error) {
    logger.error("Error fetching upcoming treatment:", error);
    return res.status(500).json({
      message: "An error occurred while fetching the upcoming treatment",
      error: error.message,
    });
  }
});
// Get a specific treatment
exports.getTreatment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const treatment = await prisma.treatments.findUnique({
    where: { id: BigInt(id) },
  });

  if (!treatment) {
    logger.warn({ id }, "No treatment found with that id");
    throw new NotFoundError("No treatment found with that id");
  }

  const treatmentResponse = {
    ...treatment,
    id: treatment.id.toString(),
    case_id: treatment.case_id.toString(),
    treatment_number: treatment.treatment_number.toString(),
  };

  logger.info({ treatmentResponse }, "Treatment retrieved");
  return new SuccessResponse(treatmentResponse).send(res);
});

const fetchTreatmentSteps = async (case_id) => {};

exports.getTreatmentStep = asyncHandler(async (req, res) => {
  const { case_id } = req.params;
  logger.info(
    `[INFO] Received request to fetch treatment step for case_id: ${case_id}`
  );

  try {
    // Step 1: Fetch the `iiwgl_link` for the given `case_id`
    logger.info(`[INFO] Fetching the latest labo_link for case_id: ${case_id}`);
    const laboLink = await prisma.labo_links.findFirst({
      where: { case_id },
      orderBy: { created_at: "desc" },
    });

    if (!laboLink || !laboLink.iiwgl_link) {
      logger.error(`[ERROR] No iiwgl_link found for case_id: ${case_id}`);
      return res
        .status(404)
        .json({ error: "iiwgl_link not found for the given case_id" });
    }

    logger.info(`[INFO] Fetched last iiwgl_link: ${laboLink.iiwgl_link}`);
    const iiwglLink = laboLink.iiwgl_link;

    // Step 2: Parse the `iiwgl_link` to extract the URL
    logger.info(`[INFO] Parsing iiwgl_link to extract URL`);
    let extractedUrl;

    if (iiwglLink.startsWith("[")) {
      logger.info(`[INFO] Detected JSON array structure in iiwgl_link`);
      try {
        const links = JSON.parse(iiwglLink);
        const patientLink = links.find((link) => link.type === "patient");
        extractedUrl = patientLink?.url;
        logger.info(`[INFO] Extracted URL from JSON: ${extractedUrl}`);
      } catch (parseError) {
        logger.error(
          `[ERROR] Failed to parse JSON structure in iiwgl_link: ${parseError.message}`
        );
        return res
          .status(400)
          .json({ error: "Invalid JSON structure in iiwgl_link" });
      }
    } else {
      logger.info(`[INFO] Detected direct link scenario`);

      extractedUrl = iiwglLink;
      logger.info(`[INFO] Extracted URL from direct link: ${extractedUrl}`);
    }

    if (!extractedUrl) {
      logger.error(`[ERROR] No valid URL extracted from iiwgl_link`);
      return res
        .status(400)
        .json({ error: "No valid URL found in the iiwgl_link" });
    }

    // Step 2.1: Check if the URL contains "smilesummary"
    if (
      extractedUrl.includes("smilesummary") ||
      extractedUrl.includes("smilestudio")
    ) {
      logger.error(
        `[ERROR] Extracted URL contains "smilesummary": ${extractedUrl}`
      );
      return res.status(400).json({ error: "Invalid URL" });
    }

    // Step 3: Open the URL using Puppeteer and fetch the text content
    logger.info(`[INFO] Launching Puppeteer browser`);
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    logger.info(`[INFO] Navigating to extracted URL: ${extractedUrl}`);
    await page.goto(extractedUrl, { waitUntil: "networkidle2" });

    logger.info(`[INFO] Looking for iframe on the page`);
    const iframeElement = await page.waitForSelector(
      'iframe[name="OnyxCephWebGL"]',
      { timeout: 60000 }
    );
    const iframe = await iframeElement.contentFrame();

    if (!iframe) {
      logger.error(`[ERROR] Unable to find iframe with name "OnyxCephWebGL"`);
      await browser.close();
      return res.status(404).json({ error: "Iframe not found on the page" });
    }

    logger.info(`[INFO] Switching context to iframe`);
    const selector = "#aniText";
    logger.info(
      `[INFO] Waiting for element with selector ${selector} inside iframe`
    );
    await iframe.waitForSelector(selector, { timeout: 50000 });

    logger.info(`[INFO] Extracting text content from selector: ${selector}`);
    const extractedText = await iframe.$eval(selector, (element) =>
      element.textContent.trim()
    );

    logger.info(`[INFO] Full extracted text: ${extractedText}`);

    // Extract only the last number
    const lastNumber = extractedText.match(/\d+$/)?.[0];
    logger.info(`[INFO] Extracted last number: ${lastNumber}`);

    await browser.close();
    logger.info(`[INFO] Browser closed`);

    // Update the start_date to the current date and the `started` status
    const updatedCase = await prisma.cases.update({
      where: { id: BigInt(case_id) },
      data: { steps: String(lastNumber) },
    });
    logger.info("updatedCase:", updatedCase);
    const serializedUpdatedCase = {
      ...updatedCase,
      id: Number(updatedCase.id),
      patient_id: Number(updatedCase.patient_id),
      doctor_id: Number(updatedCase.doctor_id),
      pack_id: Number(updatedCase.pack_id),
    }; // Step 4: Return the extracted number
    logger.info(
      `[INFO] Successfully fetched treatment step number for case_id: ${case_id}`
    );
    return res.json({
      message: "steps added to case successfully",
      data: serializedUpdatedCase,
    });
  } catch (error) {
    logger.error(
      `[ERROR] Error fetching treatment step for case_id: ${case_id}`,
      error
    );

    // Capture additional details for Puppeteer errors
    if (error.message.includes("failed to find element")) {
      logger.error(
        `[ERROR] Element with selector #aniText not found in iframe`
      );
    } else if (error.message.includes("net::ERR_ABORTED")) {
      logger.error(
        `[ERROR] Failed to load URL: likely invalid or inaccessible`
      );
    }

    return res.status(500).json({ error: "Internal server error" });
  }
});

// exports.createTreatment = asyncHandler(async (req, res) => {
//   const { case_id, start_date, end_date, frequency,treatment_status} = req.body;

//   // Check if the case exists
//   const existingCase = await prisma.cases.findUnique({
//     where: { id: BigInt(case_id) },
//   });

//   if (!existingCase) {
//     logger.warn({ case_id }, "No case found with that id");
//     throw new NotFoundError("No case found with that id");
//   }

//   const existingTreatmentForCase = await prisma.treatments.findUnique({
//     where: {
//       case_id_treatment_number: {
//         case_id: BigInt(case_id),
//         treatment_number: BigInt(1), // Adjust this based on how you're determining treatment_number
//       },
//     },
//   });

//   if (existingTreatmentForCase) {
//     throw new BadRequestError("Ce cas a déjà un traitement.");
//   }
//   // Calculate the number of treatments to be created
//   const startDate = new Date(start_date);
//   const endDate = new Date(end_date);
//   const frequencyInDays = parseInt(frequency); // Ensure frequency is in days

//   const numTreatments = Math.floor((endDate - startDate) / (frequencyInDays * 24 * 60 * 60 * 1000)); // Calculate total treatments based on the date range and frequency

//   if (numTreatments <= 0) {
//     throw new BadRequestError("La plage de dates ou la fréquence fournie est incorrecte.");
//   }
//   // if (startDate == endDate) {
//   //   throw new BadRequestError("La date de début et la date de fin ne peuvent pas être identiques.");
//   // }
//   // Create the treatments in a loop
//   const treatments = [];
//   for (let i = 0; i < numTreatments; i++) {
//     const treatmentStartDate = new Date(startDate);
//     treatmentStartDate.setDate(treatmentStartDate.getDate() + i * frequencyInDays);

//     const treatmentEndDate = new Date(startDate);
//     treatmentEndDate.setDate(treatmentEndDate.getDate() + (i + 1) * frequencyInDays);
//   // If this is the last treatment, set the time to 23:59:59 to include the full day
//     if (i === numTreatments - 1) {
//       treatmentEndDate.setHours(24, 59, 59, 999);
//     }
//     const newTreatment = await prisma.treatments.create({
//       data: {
//         case_id: BigInt(case_id),
//         treatment_number: BigInt(i + 1), // Increment treatment_number for each treatment
//         start_date: treatmentStartDate,
//         end_date: treatmentEndDate,
//         // status: status || false, // Optional status defaults to false if not provided
//         // Empty slots for videos
//         video_horizontal_link: null,
//         video_vertical_link: null,
//         video_outer_link: null,
//         video_horizontal_upload_date:null,
//         video_vertical_upload_date:null,
//         video_outer_upload_date:null
//       },
//     });
//     logger.info(treatments);
//     // Push the created treatment to the array
//     treatments.push({
//       ...newTreatment,
//       id: newTreatment.id.toString(),
//       case_id: newTreatment.case_id.toString(),
//       treatment_number: newTreatment.treatment_number.toString(),
//     });
//   }
//   await prisma.cases.update({
//     where: { id: BigInt(case_id) },
//     data: { treatment_exists:true }, // Update the treatment_status field based on the request body
//   });
//   // Update the case's treatment status
//   if (treatment_status === true) {
//     await prisma.cases.update({
//       where: { id: BigInt(case_id) },
//       data: { treatment_status }, // Update the treatment_status field based on the request body
//     });
//   }
//   logger.info({ treatments }, "Treatments created");
//   return new SuccessResponse(treatments).send(res); // Send all created treatments in response
// });

exports.createTreatment = asyncHandler(async (req, res) => {
  /* const { case_id } = req.body; */
  const { steps, case_id } = req.body;

  // Validate input
  if (!case_id) {
    throw new BadRequestError("case_id is required.");
  }

  // Check if treatments already exist for the given case_id
  const existingTreatment = await prisma.treatments.findFirst({
    where: { case_id: BigInt(case_id) },
  });

  if (existingTreatment) {
    logger.warn({ case_id }, "A treatment already exists for this case_id");
    throw new BadRequestError("A treatment already exists for this case_id.");
  }

  // Check if the case exists
  const existingCase = await prisma.cases.findUnique({
    where: { id: BigInt(case_id) },
  });

  if (!existingCase) {
    logger.warn({ case_id }, "No case found with that id");
    throw new NotFoundError("No case found with that id");
  }

  // Fetch the latest 'redesign_requested' entry from status_histories for the given case_id
  const lastRedesignRequested = await prisma.status_histories.findFirst({
    where: {
      caseId: BigInt(case_id),
      name: "redesign_requested",
    },
    orderBy: {
      created_at: "desc",
    },
  });

  // Use the found date as startDate or default to the current date
  const startDate = lastRedesignRequested
    ? new Date(lastRedesignRequested.created_at)
    : new Date();

  // Fetch the number of steps using the refactored utility function
  /* let updatedCase;
  try {
    updatedCase = await fetchTreatmentSteps(case_id);
  } catch (error) {
    logger.error({ case_id, error }, "Failed to fetch treatment steps");
    throw new BadRequestError(
      `Failed to fetch treatment steps: ${error.message}`
    );
  }

  const steps = parseInt(updatedCase?.steps, 10);

  if (isNaN(steps) || steps <= 0) {
    throw new BadRequestError("Invalid number of steps for the treatments.");
  } */

  const treatments = [];
  let currentStartDate = new Date(startDate);

  // Generate a unique QR code for this treatment
  const generateCode = () => {
    return Math.random().toString(36).substr(2, 9); // Example: 'abcd1234'
  };

  for (let i = 0; i < steps; i++) {
    const code = generateCode();

    // Create the treatment in the database
    const newTreatment = await prisma.treatments.create({
      data: {
        case_id: BigInt(case_id),
        treatment_number: BigInt(i + 1), // Increment treatment_number for each treatment
        qr_code: code, // Save the generated QR code
        video_without_aligners_link: null,
        video_with_aligners_link: null,
        video_without_aligners_upload_date: null,
        video_with_aligners_upload_date: null,
      },
    });

    // Push the created treatment to the array
    treatments.push({
      ...newTreatment,
      id: newTreatment.id.toString(),
      case_id: newTreatment.case_id.toString(),
      treatment_number: newTreatment.treatment_number.toString(),
    });
  }

  // Update the case's treatment_exists field
  await prisma.cases.update({
    where: { id: BigInt(case_id) },
    data: { treatment_exists: true },
  });

  logger.info({ treatments }, "Treatments created");
  return new SuccessResponse(treatments).send(res); // Send all created treatments in response
});

exports.updateTreatments = asyncHandler(async (req, res) => {
  const { case_id, frequency, start_date } = req.body;

  // Validate input
  if (!case_id || !frequency || !start_date) {
    throw new BadRequestError(
      "Missing required parameters: case_id, frequency, start_date."
    );
  }

  if (typeof frequency !== "number" || frequency < 7 || frequency > 20) {
    throw new BadRequestError(
      "Invalid frequency. Must be a number between 7 and 20 days."
    );
  }

  // Fetch all existing treatments for the case_id
  const existingTreatments = await prisma.treatments.findMany({
    where: { case_id: BigInt(case_id) },
    orderBy: { treatment_number: "asc" }, // Ensure ordered sequence
  });

  if (!existingTreatments.length) {
    logger.warn({ case_id }, "No treatments found for this case_id.");
    throw new NotFoundError("No treatments found for this case_id.");
  }
  logger.info("start_date: ", start_date);
  // Convert start_date to Date object and normalize time to UTC midnight
  let currentStartDate = new Date(start_date);
  currentStartDate.setHours(currentStartDate.getHours() + 1);
  logger.info("currentStartDate: ", currentStartDate);

  currentStartDate.setUTCHours(0, 0, 0, 0);

  // Prepare data for updates
  const treatmentUpdates = existingTreatments.map((treatment, index) => {
    // Calculate end_date based on frequency
    const endDate = new Date(currentStartDate);
    endDate.setUTCDate(endDate.getUTCDate() + frequency - 1);
    endDate.setUTCHours(23, 59, 59, 999); // Set end time to UTC 23:59:59

    // Prepare updated treatment data
    const updatedTreatmentData = {
      start_date: currentStartDate,
      end_date: endDate,
      treatment_number: BigInt(index + 1), // Ensure sequential treatment numbers
    };

    // Move to the next treatment start date (1 min gap)
    currentStartDate = new Date(endDate);
    currentStartDate.setUTCMinutes(currentStartDate.getUTCMinutes() + 1);

    return {
      where: { id: treatment.id },
      data: updatedTreatmentData,
    };
  });

  try {
    // Perform updates within a transaction
    const transactionResults = await prisma.$transaction([
      // Bulk update treatments
      ...treatmentUpdates.map((update) => prisma.treatments.update(update)),
      // Update the case's treatment_started field with a Boolean value
      prisma.cases.update({
        where: { id: BigInt(case_id) },
        data: { treatment_started: true }, // Assign Boolean value
      }),
    ]);

    // Assume the last element is the case update
    const caseUpdate = transactionResults[transactionResults.length - 1];
    const updatedTreatmentsList = transactionResults.slice(0, -1);

    // Serialize treatments
    const serializedTreatments = updatedTreatmentsList.map((treatment) => ({
      ...treatment,
      id: treatment.id.toString(),
      case_id: treatment.case_id.toString(),
      treatment_number: treatment.treatment_number.toString(),
    }));

    // Serialize caseUpdate if it exists
    let serializedCase = null;
    if (caseUpdate) {
      serializedCase = {
        ...caseUpdate,
        id: caseUpdate.id.toString(),
        patient_id: caseUpdate.patient_id.toString(),
        doctor_id: caseUpdate.doctor_id.toString(),
        pack_id: caseUpdate.pack_id ? caseUpdate.pack_id.toString() : null,
      };
    }

    logger.info(
      { updatedTreatments: serializedTreatments, caseUpdate: serializedCase },
      "All treatments and case updated successfully."
    );

    return new SuccessResponse({
      treatments: serializedTreatments,
      case: serializedCase,
    }).send(res);
  } catch (error) {
    logger.error({ case_id, error }, "Failed to update treatments and case.");
    throw new BadRequestError(`Failed to update treatments: ${error.message}`);
  }
});

// check if qr code is corresponding to the current treatment slot or not
exports.verifyTreatmentSlot = asyncHandler(async (req, res) => {
  const { currentSlotId } = req.params; // Current treatment slot ID passed as a URL parameter
  const { qr_code } = req.body; // QR code from the request body

  // Validate inputs
  if (!currentSlotId || !qr_code) {
    return res
      .status(400)
      .json({ message: "Current slot ID or QR code is missing." });
  }

  try {
    // Fetch the treatment that corresponds to the provided QR code
    const treatmentByQrCode = await prisma.treatments.findFirst({
      where: {
        qr_code: qr_code, // Match the QR code
      },
    });
    logger.info("treatmentByQrCode: ", treatmentByQrCode);
    logger.info("treatmentByQrCode: ", currentSlotId);

    if (!treatmentByQrCode) {
      return res
        .status(404)
        .json({ message: "Invalid QR code: No treatment found." });
    }

    // Check if the treatment ID matches the current slot ID
    if (treatmentByQrCode.id.toString() !== currentSlotId) {
      return res.status(400).json({
        message: "QR code does not correspond to the current treatment slot.",
      });
    }

    // Update the treatment to mark it as valid
    const updatedTreatment = await prisma.treatments.update({
      where: { id: BigInt(currentSlotId) },
      data: { verified: true }, // Mark as valid
    });
    const serializedUpdatedTreatment = {
      ...updatedTreatment,
      id: Number(updatedTreatment.id),
      case_id: Number(updatedTreatment.case_id),
      treatment_number: Number(updatedTreatment.treatment_number),
    };
    return res.status(200).json({
      message: "QR code successfully verified and treatment marked as valid.",
      treatment: serializedUpdatedTreatment,
    });
  } catch (error) {
    logger.error("Error verifying treatment slot:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// Fetch video details from api.video

exports.getVideoObj = asyncHandler(async (req, res) => {
  const { videoId } = req.params; // Use req.params to get videoId from the route

  logger.info("Received videoId:", videoId); // Log to verify videoId

  if (!videoId) {
    logger.error("No videoId provided in the request parameters.");
    return res.status(400).json({ error: "Missing video ID" });
  }

  try {
    const client = new ApiVideoClient({
      apiKey: process.env.API_VIDEO_API_KEY,
    });
    logger.info("ApiVideoClient initialized successfully.");

    // Fetch video details and log the response for further inspection
    const videoDetails = await client.videos.get(videoId);
    logger.info("Fetched video details:", videoDetails);

    return res.status(200).json(videoDetails);
  } catch (error) {
    logger.error(
      `Error fetching video details for videoId "${videoId}":`,
      error
    );
    return res
      .status(500)
      .json({ error: "Failed to fetch video details", details: error.message });
  }
});

exports.postVideoObj = asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    const filePath = req.file.path; // Path to the uploaded video file
    const { title, description, type, treatment_slot } = req.body;
    logger.info("req.file", req.file);
    logger.info("req.body", title, description, type, treatment_slot); // Should log additional form data like title and description

    // Step 1: Create a new video object on ApiVideo
    const videoCreationPayload = {
      title: title || "Untitled Video",
      description: description || "No description",
    };
    const client = new ApiVideoClient({
      apiKey: process.env.API_VIDEO_API_KEY,
    });
    const video = await client.videos.create(videoCreationPayload);
    logger.info("Video created with ID:", video.videoId);

    // Step 2: Upload the video file using the created videoId
    const uploadedVideo = await client.videos.upload(
      video.videoId,
      filePath,
      (progress) => {
        logger.info(`Upload progress: ${progress.percentage}%`);
      }
    );

    logger.info("Video uploaded successfully:", uploadedVideo);
    // step 3: update the treatment slot and its type with the video id:
    const updateData = {
      [`video_${type}_link`]: video.videoId, // Dynamically set the video link to null based on the type
    };
    const updatedTreatmentSlot = await prisma.treatments.update({
      where: { id: BigInt(treatment_slot) },
      data: updateData,
    });
    logger.info("updatedTreatmentSlot: ", updatedTreatmentSlot);
    // Respond with the uploaded video details
    res
      .status(201)
      .json({ message: "Video uploaded successfully", video: uploadedVideo });
  } catch (error) {
    logger.error("Error uploading video:", error);
    res.status(500).json({ error: "Video upload failed", details: error });
  } finally {
    // Clean up the temporary file after response
    if (req.file && req.file.path) {
      require("fs").unlinkSync(req.file.path);
    }
  }
});

exports.deleteVideoObj = asyncHandler(async (req, res) => {
  const { videoId } = req.params; // Use req.params to get videoId from the route

  logger.info("Received videoId for deletion:", videoId); // Log to verify videoId

  if (!videoId) {
    logger.error("No videoId provided in the request parameters.");
    return res.status(400).json({ error: "Missing video ID" });
  }

  try {
    const client = new ApiVideoClient({
      apiKey: process.env.API_VIDEO_API_KEY,
    });
    logger.info("ApiVideoClient initialized successfully.");

    // Delete the video using the API client
    await client.videos.delete(videoId);
    logger.info(`Video with ID "${videoId}" has been successfully deleted.`);

    return res.status(200).json({
      message: `Video with ID "${videoId}" has been successfully deleted.`,
    });
  } catch (error) {
    logger.error(`Error deleting video with videoId "${videoId}":`, error);
    return res.status(500).json({
      error: "Failed to delete video",
      details: error.message,
    });
  }
});

exports.checkVideoStatus = asyncHandler(async (req, res) => {
  try {
    const client = new ApiVideoClient({
      apiKey: process.env.API_VIDEO_API_KEY,
    });
    const videoId = req.params.videoId;

    // Get video details using ApiVideoClient
    const video = await client.videos.getStatus(videoId);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Send the inferred status
    res.status(200).json(video);
  } catch (error) {
    logger.error("Error checking video status:", error);
    res
      .status(500)
      .json({ error: "Failed to check video status", details: error.message });
  }
});

exports.updateFirstTreatmentStartDate = async (req, res) => {
  const { caseId } = req.params;
  const { started } = req.body;

  try {
    // Find the first treatment by case_id, sorted by treatment_number
    const firstTreatment = await prisma.treatments.findFirst({
      where: {
        case_id: Number(caseId), // Ensure the caseId is a number
      },
      orderBy: {
        treatment_number: "asc", // Sort by treatment_number in ascending order
      },
    });

    if (!firstTreatment) {
      return res
        .status(404)
        .json({ message: "No treatment found for the given case ID." });
    }
    // Update the start_date to the current date and the `started` status
    const updatedTreatment = await prisma.treatments.update({
      where: {
        id: firstTreatment.id, // Update based on the unique ID of the first treatment found
      },
      data: {
        start_date: new Date(), // Set to the current date
        cases: {
          update: {
            treatment_started: Boolean(started), // Update the `started` status in the related `cases` table
          },
        },
      },
    });
    const serializedUpdatedTreatment = {
      ...updatedTreatment,
      id: Number(updatedTreatment.id),
      case_id: Number(updatedTreatment.case_id),
      treatment_number: Number(updatedTreatment.treatment_number),
    };
    res.status(200).json({
      message: "Start date and started status updated successfully",
      data: serializedUpdatedTreatment,
    });
  } catch (error) {
    logger.error("Error updating start date and started status:", error);
    res
      .status(500)
      .json({ message: "Failed to update start date and started status" });
  }
};

exports.updateTreatmentVideos = [
  upload.fields([
    { name: "video_without_aligners", maxCount: 1 },
    { name: "video_with_aligners", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const { id } = req.params; // treatment ID
    const videoFiles = req.files;

    // Find the existing treatment
    const existingTreatment = await prisma.treatments.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingTreatment) {
      logger.warn({ id }, "Treatment not found");
      throw new NotFoundError("Treatment not found");
    }

    const { treatment_order, treatment_number, case_id } = existingTreatment;

    // Construct the file path based on case_id, treatment_number, and treatment_order
    const localFolderPath = path.join(
      __dirname,
      `../uploads/case_${case_id}/treatment_${treatment_number}/order_${treatment_order}`
    );

    // Ensure the folder exists
    if (!fs.existsSync(localFolderPath)) {
      fs.mkdirSync(localFolderPath, { recursive: true });
    }

    let withoutAlignersScreenshots = [];
    let withAlignersScreenshots = [];
    const uploadedVideos = {};

    try {
      // Handle video without aligners upload and screenshots
      if (videoFiles.video_without_aligners) {
        const withoutAlignersVideoUrl = await uploadToApiVideo(
          videoFiles.video_without_aligners[0],
          "video_without_aligners"
        );
        const localWithoutAlignersPath = path.join(
          localFolderPath,
          "video_without_aligners.mp4"
        );
        fs.renameSync(
          videoFiles.video_without_aligners[0].path,
          localWithoutAlignersPath
        );
        uploadedVideos.video_without_aligners_link = withoutAlignersVideoUrl;

        withoutAlignersScreenshots = await generateScreenshots(
          localWithoutAlignersPath,
          "without_aligners",
          id,
          localFolderPath
        );

        // Update without aligners screenshots
        await updateVideoScreenshots(
          id,
          treatment_number,
          treatment_order,
          withoutAlignersScreenshots,
          "without_aligners"
        );
        await upsertPatientIntraOralImagesWithScreenshots(
          id,
          treatment_number,
          treatment_order,
          withoutAlignersScreenshots.slice(0, 3),
          "without_aligners"
        );
      }

      // Handle video with aligners upload and screenshots
      if (videoFiles.video_with_aligners) {
        const withAlignersVideoUrl = await uploadToApiVideo(
          videoFiles.video_with_aligners[0],
          "video_with_aligners"
        );
        const localWithAlignersPath = path.join(
          localFolderPath,
          "video_with_aligners.mp4"
        );
        fs.renameSync(
          videoFiles.video_with_aligners[0].path,
          localWithAlignersPath
        );
        uploadedVideos.video_with_aligners_link = withAlignersVideoUrl;

        withAlignersScreenshots = await generateScreenshots(
          localWithAlignersPath,
          "with_aligners",
          id,
          localFolderPath
        );

        // Update with aligners screenshots
        await updateVideoScreenshots(
          id,
          treatment_number,
          treatment_order,
          withAlignersScreenshots,
          "with_aligners"
        );
        await upsertPatientIntraOralImagesWithScreenshots(
          id,
          treatment_number,
          treatment_order,
          [withAlignersScreenshots[0]],
          "with_aligners"
        );
      }

      // Update treatment with video links
      if (Object.keys(uploadedVideos).length > 0) {
        const updatedTreatment = await prisma.treatments.update({
          where: { id: BigInt(id) },
          data: uploadedVideos,
        });
        const sanitizedUpdatedTreatment = {
          ...updatedTreatment,
          id: Number(updatedTreatment.id),
          treatment_number: Number(updatedTreatment.treatment_number),
          case_id: Number(updatedTreatment.case_id),
        };
        return res
          .status(200)
          .json({ status: "success", data: sanitizedUpdatedTreatment });
      } else {
        return res
          .status(400)
          .json({ status: "fail", message: "No videos provided for update" });
      }
    } catch (error) {
      logger.error({ error: error.message }, "Error during video handling");
      res.status(500).json({ status: "fail", message: error.message });
    } finally {
      if (videoFiles.video_without_aligners)
        fs.unlinkSync(videoFiles.video_without_aligners[0].path);
      if (videoFiles.video_with_aligners)
        fs.unlinkSync(videoFiles.video_with_aligners[0].path);
    }
  }),
];

// Function to update or create patientIntraOralImages based on the video type
const upsertPatientIntraOralImagesWithScreenshots = async (
  treatmentId,
  treatmentNumber,
  treatmentOrder,
  screenshots,
  type
) => {
  let upsertData = {};

  if (type === "horizontal") {
    upsertData = {
      image_1_link: screenshots[0] || "",
      image_2_link: screenshots[1] || "",
      image_3_link: screenshots[2] || "",
    };
  } else if (type === "upper") {
    upsertData = {
      image_4_link: screenshots[0] || "",
    };
  } else if (type === "lower") {
    upsertData = {
      image_5_link: screenshots[0] || "",
    };
  }

  // Use upsert to either update the record if it exists or create it if it doesn't
  await prisma.patientIntraOralImages.upsert({
    where: {
      treatment_id_treatment_number_treatment_order: {
        treatment_id: BigInt(treatmentId),
        treatment_number: BigInt(treatmentNumber),
        treatment_order: treatmentOrder,
      },
    },
    update: upsertData, // Update data if the record exists
    create: {
      treatment_id: BigInt(treatmentId),
      treatment_number: BigInt(treatmentNumber),
      treatment_order: treatmentOrder,
      ...upsertData, // Create new data if the record doesn't exist
    },
  });
};

// Function to update video screenshots in VideoScreenshots
const updateVideoScreenshots = async (
  treatmentId,
  treatmentNumber,
  treatmentOrder,
  screenshots,
  type
) => {
  const screenshotFields = {};

  if (type === "horizontal") {
    screenshots.forEach((screenshot, index) => {
      screenshotFields[`screenshot_horizontal_${index + 1}`] = screenshot || "";
    });
  } else if (type === "upper") {
    screenshots.forEach((screenshot, index) => {
      screenshotFields[`screenshot_upper_${index + 1}`] = screenshot || "";
    });
  } else if (type === "lower") {
    screenshots.forEach((screenshot, index) => {
      screenshotFields[`screenshot_lower_${index + 1}`] = screenshot || "";
    });
  }

  // Update or create new VideoScreenshots entry using the compound key (treatment_id, treatment_number, treatment_order)
  const existingVideoScreenshots = await prisma.videoScreenshots.findFirst({
    where: {
      treatment_id: BigInt(treatmentId),
      treatment_number: BigInt(treatmentNumber),
      treatment_order: treatmentOrder,
    },
  });

  if (existingVideoScreenshots) {
    await prisma.videoScreenshots.update({
      where: { id: existingVideoScreenshots.id },
      data: screenshotFields,
    });
  } else {
    await prisma.videoScreenshots.create({
      data: {
        treatment_id: BigInt(treatmentId),
        treatment_number: BigInt(treatmentNumber),
        treatment_order: treatmentOrder,
        ...screenshotFields,
      },
    });
  }
};

// Delete a treatment
exports.deleteTreatment = asyncHandler(async (req, res) => {
  const { case_id } = req.params;

  const treatment = await prisma.treatments.findMany({
    where: { case_id: BigInt(case_id) },
  });
  logger.info("treatment: ", treatment);
  if (!treatment || treatment.length === 0) {
    logger.warn({ case_id }, "Treatment not found");
    throw new NotFoundError("Treatment not found");
  }

  await prisma.treatments.deleteMany({ where: { case_id: BigInt(case_id) } });
  // Update the cases table to set treatment_exists and treatment_started to false
  const updatedCase = await prisma.cases.update({
    where: { id: BigInt(case_id) },
    data: {
      treatment_exists: false,
      treatment_started: false,
    },
  });
  logger.info({ case_id }, "Treatment deleted");
  return new SuccessMsgResponse("Treatment deleted successfully").send(res);
});

exports.uploadTreatmentVideos = [
  upload.fields([
    { name: "video_without_aligners", maxCount: 1 },
    { name: "video_with_aligners", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const { treatmentId } = req.params;
    const videoFiles = req.files;

    const treatment = await prisma.treatments.findUnique({
      where: { id: BigInt(treatmentId) },
    });

    if (!treatment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Treatment not found" });
    }

    const { treatment_order, treatment_number, case_id } = treatment;

    // Construct the file path as "uploads/case/treatment_number/treatment_order/"
    const localFolderPath = path.join(
      __dirname,
      `../uploads/case_${case_id}/treatment_${treatment_number}/order_${treatment_order}`
    );

    // Ensure the folder exists
    if (!fs.existsSync(localFolderPath)) {
      fs.mkdirSync(localFolderPath, { recursive: true });
    }

    // Declare variables for storing screenshots
    let withoutAlignersScreenshots = [];
    let withAlignersScreenshots = [];

    const uploadedVideos = {};

    try {
      // Upload videos to the server and API.video, then generate screenshots
      if (videoFiles.video_without_aligners) {
        const withoutAlignersVideoUrl = await uploadToApiVideo(
          videoFiles.video_without_aligners[0],
          "video_without_aligners"
        );
        const localWithoutAlignersPath = path.join(
          localFolderPath,
          "video_without_aligners.mp4"
        );
        fs.renameSync(
          videoFiles.video_without_aligners[0].path,
          localWithoutAlignersPath
        );
        uploadedVideos.video_without_aligners_link = withoutAlignersVideoUrl;

        // Generate 15 screenshots for video without aligners
        withoutAlignersScreenshots = await generateScreenshots(
          localWithoutAlignersPath,
          "without_aligners",
          treatmentId,
          localFolderPath
        );
      }

      if (videoFiles.video_with_aligners) {
        const withAlignersVideoUrl = await uploadToApiVideo(
          videoFiles.video_with_aligners[0],
          "video_with_aligners"
        );
        const localWithAlignersPath = path.join(
          localFolderPath,
          "video_with_aligners.mp4"
        );
        fs.renameSync(
          videoFiles.video_with_aligners[0].path,
          localWithAlignersPath
        );
        uploadedVideos.video_with_aligners_link = withAlignersVideoUrl;

        // Generate 10 screenshots for video with aligners
        withAlignersScreenshots = await generateScreenshots(
          localWithAlignersPath,
          "with_aligners",
          treatmentId,
          localFolderPath
        );
      }

      // Step 1: Store or update screenshots in VideoScreenshots table
      /* let videoScreenshots;

      const existingVideoScreenshots = await prisma.videoScreenshots.findFirst({
        where: {
          treatment_id: BigInt(treatmentId),
          treatment_order: treatment_order,
        },
      });

      if (existingVideoScreenshots) {
        // Update the existing screenshots
        videoScreenshots = await prisma.videoScreenshots.update({
          where: { id: existingVideoScreenshots.id },
          data: {
            screenshot_without_aligners_1: withoutAlignersScreenshots[0] || "",
            screenshot_without_aligners_2: withoutAlignersScreenshots[1] || "",
            screenshot_without_aligners_3: withoutAlignersScreenshots[2] || "",
            screenshot_without_aligners_4: withoutAlignersScreenshots[3] || "",
            screenshot_without_aligners_5: withoutAlignersScreenshots[4] || "",
            screenshot_without_aligners_6: withoutAlignersScreenshots[5] || "",
            screenshot_without_aligners_7: withoutAlignersScreenshots[6] || "",
            screenshot_without_aligners_8: withoutAlignersScreenshots[7] || "",
            screenshot_without_aligners_9: withoutAlignersScreenshots[8] || "",
            screenshot_without_aligners_10: withoutAlignersScreenshots[9] || "",
            screenshot_without_aligners_11:
              withoutAlignersScreenshots[10] || "",
            screenshot_without_aligners_12:
              withoutAlignersScreenshots[11] || "",
            screenshot_without_aligners_13:
              withoutAlignersScreenshots[12] || "",
            screenshot_without_aligners_14:
              withoutAlignersScreenshots[13] || "",
            screenshot_without_aligners_15:
              withoutAlignersScreenshots[14] || "",
            screenshot_with_aligners_1: withAlignersScreenshots[0] || "",
            screenshot_with_aligners_2: withAlignersScreenshots[1] || "",
            screenshot_with_aligners_3: withAlignersScreenshots[2] || "",
            screenshot_with_aligners_4: withAlignersScreenshots[3] || "",
            screenshot_with_aligners_5: withAlignersScreenshots[4] || "",
            screenshot_with_aligners_6: withAlignersScreenshots[5] || "",
            screenshot_with_aligners_7: withAlignersScreenshots[6] || "",
            screenshot_with_aligners_8: withAlignersScreenshots[7] || "",
            screenshot_with_aligners_9: withAlignersScreenshots[8] || "",
            screenshot_with_aligners_10: withAlignersScreenshots[9] || "",
          },
        });
      } else {
        // Create new screenshots if not found
        videoScreenshots = await prisma.videoScreenshots.create({
          data: {
            treatment_id: BigInt(treatmentId),
            treatment_order: treatment_order,
            // Removed treatment_number as it doesn't exist in VideoScreenshots model
            screenshot_without_aligners_1: withoutAlignersScreenshots[0] || "",
            screenshot_without_aligners_2: withoutAlignersScreenshots[1] || "",
            screenshot_without_aligners_3: withoutAlignersScreenshots[2] || "",
            screenshot_without_aligners_4: withoutAlignersScreenshots[3] || "",
            screenshot_without_aligners_5: withoutAlignersScreenshots[4] || "",
            screenshot_without_aligners_6: withoutAlignersScreenshots[5] || "",
            screenshot_without_aligners_7: withoutAlignersScreenshots[6] || "",
            screenshot_without_aligners_8: withoutAlignersScreenshots[7] || "",
            screenshot_without_aligners_9: withoutAlignersScreenshots[8] || "",
            screenshot_without_aligners_10: withoutAlignersScreenshots[9] || "",
            screenshot_without_aligners_11:
              withoutAlignersScreenshots[10] || "",
            screenshot_without_aligners_12:
              withoutAlignersScreenshots[11] || "",
            screenshot_without_aligners_13:
              withoutAlignersScreenshots[12] || "",
            screenshot_without_aligners_14:
              withoutAlignersScreenshots[13] || "",
            screenshot_without_aligners_15:
              withoutAlignersScreenshots[14] || "",
            screenshot_with_aligners_1: withAlignersScreenshots[0] || "",
            screenshot_with_aligners_2: withAlignersScreenshots[1] || "",
            screenshot_with_aligners_3: withAlignersScreenshots[2] || "",
            screenshot_with_aligners_4: withAlignersScreenshots[3] || "",
            screenshot_with_aligners_5: withAlignersScreenshots[4] || "",
            screenshot_with_aligners_6: withAlignersScreenshots[5] || "",
            screenshot_with_aligners_7: withAlignersScreenshots[6] || "",
            screenshot_with_aligners_8: withAlignersScreenshots[7] || "",
            screenshot_with_aligners_9: withAlignersScreenshots[8] || "",
            screenshot_with_aligners_10: withAlignersScreenshots[9] || "",
          },
        });
      } */

      // Step 2: Automatically assign selected screenshots to patientIntraOralImages
      const existingIntraOralImages =
        await prisma.patientIntraOralImages.findFirst({
          where: {
            treatment_id: BigInt(treatmentId),
            treatment_number: BigInt(treatment_number),
          },
        });

      const screenshotsToAssign = {
        image_1_link: withoutAlignersScreenshots[0] || "", // First screenshot from video without aligners
        image_2_link: withoutAlignersScreenshots[7] || "", // Middle screenshot from video without aligners
        image_3_link: withoutAlignersScreenshots[14] || "", // Last screenshot from video without aligners
        image_4_link: withAlignersScreenshots[3] || "", // Screenshot from video with aligners
        image_5_link: withAlignersScreenshots[7] || "", // Another screenshot from video with aligners
      };

      let intraOralImages;

      if (existingIntraOralImages) {
        // Update the existing patientIntraOralImages
        intraOralImages = await prisma.patientIntraOralImages.update({
          where: {
            treatment_id_treatment_number: {
              treatment_id: BigInt(treatmentId),
              treatment_number: BigInt(treatment_number),
            },
          },
          data: screenshotsToAssign,
        });
      } else {
        // Create new patientIntraOralImages with the treatment_id and treatment_number
        intraOralImages = await prisma.patientIntraOralImages.create({
          data: {
            treatment_id: BigInt(treatmentId),
            treatment_number: BigInt(treatment_number),
            ...screenshotsToAssign,
          },
        });
      }

      // Step 3: Update the treatment with the uploaded video links
      const updatedTreatment = await prisma.treatments.update({
        where: { id: BigInt(treatmentId) },
        data: uploadedVideos, // Update the video links in the treatment
      });

      // Convert BigInt values to number before sending the response
      const sanitizedIntraOralImages = {
        ...intraOralImages,
        id: Number(intraOralImages.id),
        treatment_id: Number(intraOralImages.treatment_id),
        treatment_number: Number(intraOralImages.treatment_number),
      };

      /* const sanitizedVideoScreenshots = {
        ...videoScreenshots,
        id: Number(videoScreenshots.id),
        treatment_id: Number(videoScreenshots.treatment_id),
        treatment_order: videoScreenshots.treatment_order,
      }; */

      res.status(201).json({
        status: "success",
        data: {
          treatment: uploadedVideos, // Uploaded video URLs
          /* videoScreenshots: sanitizedVideoScreenshots, */ // Converted videoScreenshots
          intraOralImages: sanitizedIntraOralImages, // Converted intraOralImages
        },
      });
    } catch (error) {
      res.status(500).json({ status: "fail", message: error.message });
    }
  }),
];

// Function to generate screenshots from a video
const generateScreenshots = async (
  videoPath,
  type,
  treatmentId,
  localFolderPath
) => {
  return new Promise((resolve, reject) => {
    const screenshotsFolderPath = path.join(
      localFolderPath,
      `${type}_screenshots`
    );

    // Create the screenshots folder if it doesn't exist
    if (!fs.existsSync(screenshotsFolderPath)) {
      fs.mkdirSync(screenshotsFolderPath, { recursive: true });
    }

    const screenshotFilenames = [];

    // Set the number of screenshots based on the video type
    let screenshotCount = 5; // Default screenshot count for upper and lower
    if (type === "horizontal") {
      screenshotCount = 15; // Generate 15 screenshots for horizontal video
    }

    // Use ffmpeg to take screenshots from the video
    ffmpeg(videoPath)
      .on("end", () => {
        logger.info(`Screenshots generated for ${type} video`);
        resolve(screenshotFilenames);
      })
      .on("error", (err) => {
        logger.error(`Error generating screenshots for ${type} video: `, err);
        reject(err);
      })
      .screenshots({
        count: screenshotCount, // Number of screenshots to generate
        folder: screenshotsFolderPath,
        filename: `${type}_screenshot_%i.png`,
        size: "1920x1080", // Customize the size here
      })
      .on("filenames", (filenames) => {
        filenames.forEach((filename) => {
          screenshotFilenames.push(path.join(screenshotsFolderPath, filename));
        });
      });
  });
};

// Fetch all screenshots for a given treatment
exports.getTreatmentScreenshots = asyncHandler(async (req, res) => {
  const { treatmentId } = req.params;

  const screenshots = await prisma.videoScreenshots.findMany({
    where: { treatment_order: BigInt(treatmentId) },
    select: {
      screenshot_horizontal_1: true,
      screenshot_horizontal_2: true,
      screenshot_horizontal_3: true,
      screenshot_upper_1: true,
      screenshot_lower_1: true,
    },
  });

  if (!screenshots.length) {
    return res.status(404).json({
      status: "fail",
      message: "No screenshots found for this treatment",
    });
  }

  res.status(200).json({ status: "success", data: screenshots });
});

// Get treatments by case ID
exports.getTreatmentsByCaseId = asyncHandler(async (req, res) => {
  const { caseId } = req.params;
  const available_cases = req.session.cases;
  logger.info("caseId in available_cases: ", caseId in available_cases);
  if (caseId in available_cases) {
    return res.status(401).json({ error: "Unauthorized access" });
  }
  // Fetch treatments related to the provided case_id
  const treatments = await prisma.treatments.findMany({
    where: {
      case_id: BigInt(caseId), // Convert the caseId to BigInt
    },
    orderBy: {
      treatment_number: "asc", // Order treatments by treatment_order
    },
  });

  // Check if no treatments were found
  if (!treatments || treatments.length === 0) {
    logger.warn({ caseId }, "No treatments found for this case");
    return res.status(500).json({
      message: "No treatments found for this case",
      treatments,
    });
  }

  // Format each treatment to the required structure, converting BigInt fields to strings
  const formattedTreatments = treatments.map((treatment) => ({
    id: treatment.id.toString(),
    case_id: treatment.case_id.toString(),
    treatment_number: treatment.treatment_number.toString(),
    video_without_aligners_link: treatment.video_without_aligners_link || null,
    video_with_aligners_link: treatment.video_with_aligners_link || null,
    video_without_aligners_upload_date:
      treatment.video_without_aligners_upload_date,
    video_with_aligners_upload_date: treatment.video_with_aligners_upload_date,
    video_without_aligners_status:
      treatment.video_without_aligners_status || "pending",
    video_with_aligners_status:
      treatment.video_with_aligners_status || "pending",
    start_date: treatment.start_date,
    end_date: treatment.end_date,
    status: treatment.status || "pending",
    finalized: treatment.finalized,
    qr_code: treatment.qr_code,
    verified: treatment.verified,
  }));

  // Return treatments as an array
  return res.status(200).json({ status: "success", data: formattedTreatments });
});

exports.finalizeTreatment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { finalized } = req.body;

  try {
    // Fetch the treatment record first
    const treatment = await prisma.treatments.findUnique({
      where: { id: BigInt(id) },
      select: {
        video_without_aligners_link: true,
        video_with_aligners_link: true,
        finalized: true,
      },
    });

    if (!treatment) {
      return res.status(404).json({ message: "Treatment not found" });
    }

    // Ensure that all required video links are present before finalizing
    if (
      !treatment.video_without_aligners_link ||
      !treatment.video_with_aligners_link
    ) {
      return res.status(400).json({
        message: "Cannot finalize treatment. All video links must be provided.",
        missingFields: {
          video_without_aligners_link: !treatment.video_without_aligners_link
            ? "Missing"
            : "OK",
          video_with_aligners_link: !treatment.video_with_aligners_link
            ? "Missing"
            : "OK",
        },
      });
    }

    // Proceed with updating the treatment record
    const updatedTreatment = await prisma.treatments.update({
      where: { id: BigInt(id) },
      data: {
        finalized,
      },
    });

    const serializedUpdatedTreatment = {
      ...updatedTreatment,
      id: Number(updatedTreatment.id),
      case_id: Number(updatedTreatment.case_id),
      treatment_number: Number(updatedTreatment.treatment_number),
    };

    logger.info(serializedUpdatedTreatment);

    res.status(200).json({
      message: "Treatment updated successfully",
      data: serializedUpdatedTreatment,
    });
  } catch (error) {
    logger.error("Error updating treatment:", error);
    res.status(500).json({
      message: "An error occurred while updating the treatment",
      error: error.message,
    });
  }
});

exports.updateTreatmentSlot = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    // Update the treatment in the database
    const updatedTreatment = await prisma.treatments.update({
      where: { id: Number(id) },
      data: { status },
    });
    logger.info("updatedTreatment: ", updatedTreatment);
    const serializedUpdatedTreatment = {
      ...updatedTreatment,
      id: Number(updatedTreatment.id),
      case_id: Number(updatedTreatment.case_id),
      treatment_number: Number(updatedTreatment.treatment_number),
    };
    res.status(200).json({
      status: "success",
      data: serializedUpdatedTreatment,
    });
  } catch (error) {
    logger.error("Error updating treatment:", error);
    res.status(500).json({
      status: "fail",
      message: "An error occurred while updating the treatment.",
    });
  }
};
exports.updateTreatmentsByCaseId = asyncHandler(async (req, res) => {
  const { caseId } = req.params;

  try {
    // Fetch all treatments for the given case, ordered by start_date
    const treatments = await prisma.treatments.findMany({
      where: { case_id: BigInt(caseId) },
      orderBy: { start_date: "asc" },
    });

    const currentDate = new Date();

    // Process each treatment and update status based on date ranges
    for (let i = 0; i < treatments.length; i++) {
      const treatment = treatments[i];
      const startDate = new Date(treatment.start_date);
      const endDate = new Date(treatment.end_date);

      // If current date is after end date and treatment is in_progress, mark as overdue
      if (currentDate > endDate && treatment.status === "in_progress") {
        await prisma.treatments.update({
          where: { id: treatment.id },
          data: { status: "overdue" },
        });
      }
      // If current date is between start and end date and treatment is pending, mark as in_progress
      else if (
        currentDate >= startDate &&
        currentDate <= endDate &&
        treatment.status === "pending"
      ) {
        await prisma.treatments.update({
          where: { id: treatment.id },
          data: { status: "in_progress" },
        });
      }
    }

    // Refetch all treatments for the case after updates
    const updatedTreatments = await prisma.treatments.findMany({
      where: { case_id: BigInt(caseId) },
      orderBy: { start_date: "asc" },
    });

    // Properly serialize the array of treatments
    const serializedTreatments = updatedTreatments.map((treatment) => ({
      ...treatment,
      id: Number(treatment.id),
      case_id: Number(treatment.case_id),
      treatment_number: Number(treatment.treatment_number),
    }));

    res.status(200).json(serializedTreatments);
  } catch (error) {
    logger.error("Error updating treatment statuses:", error);
    res.status(500).json({ error: "Failed to update treatment statuses" });
  }
});

exports.finalizeUpdate = asyncHandler(async (req, res) => {
  const { id, type, finalized } = req.body;
  logger.info(req.body);
  // Validate input
  if (!id || finalized === undefined) {
    return res.status(400).json({
      status: "fail",
      message:
        "Invalid input. Treatmen Slot ID and finalized status are required.",
    });
  }
  const updateData = {
    finalized,
    [`video_${type}_link`]: null, // Dynamically set the video link to null based on the type
  };
  try {
    // Update the finalized status of the treatment by ID
    const updatedTreatmentSlot = await prisma.treatments.update({
      where: { id: id }, // Ensure the ID is a number
      data: updateData,
    });
    logger.info("updatedTreatmentSlot", updatedTreatmentSlot);
    const serializedUpdatedTreatmentSlot = {
      ...updatedTreatmentSlot,
      id: Number(updatedTreatmentSlot.id),
      case_id: Number(updatedTreatmentSlot.case_id),
      treatment_number: Number(updatedTreatmentSlot.treatment_number),
    };
    // Return a success response with the updated treatment data
    return res
      .status(200)
      .json({ status: "success", data: serializedUpdatedTreatmentSlot });
  } catch (error) {
    logger.error("Error updating treatment finalized status:", error);
    return res.status(500).json({
      status: "fail",
      message: "Failed to update the treatment finalized status.",
    });
  }
});

exports.updateVideoLink = asyncHandler(async (req, res) => {
  const { id, type, finalized } = req.body;

  // Validate input
  if (!id || !type) {
    return res.status(400).json({
      status: "fail",
      message: "Invalid input. Treatment ID and type are required.",
    });
  }

  try {
    // Dynamically build the data object for the update
    const updateData = {
      finalized,
      [`video_${type}_link`]: null, // Dynamically set the video link to null based on the type
    };

    // Update the treatment record
    const updatedTreatment = await prisma.treatments.update({
      where: { id: BigInt(id) }, // Ensure the ID is a BigInt if required
      data: updateData,
    });
    const serializedUpdatedTreatment = {
      ...updatedTreatment,
      id: Number(updatedTreatment.id),
      case_id: Number(updatedTreatment.case_id),
      treatment_number: Number(updatedTreatment.treatment_number),
    };
    // Return the updated treatment as a response
    res
      .status(200)
      .json({ status: "success", video: serializedUpdatedTreatment });
  } catch (error) {
    logger.error("Error updating video link:", error);
    res
      .status(500)
      .json({ status: "fail", message: "Failed to update the video link." });
  }
});

exports.postComment = asyncHandler(async (req, res) => {
  const { case_id, treatment_id, comment } = req.body;
  const user_id = req.session.userId; // Assuming session contains the logged-in user ID

  if (!case_id || !treatment_id || !comment) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  logger.info(case_id, treatment_id, user_id, comment);
  try {
    current_date = new Date();
    console.log("current_date: ", current_date);
    console.log(case_id, treatment_id, user_id, comment);
    const createdComment = await prisma.treatment_comments.create({
      data: {
        case_id: BigInt(case_id),
        treatment_id: BigInt(treatment_id),
        user_id: BigInt(user_id),
        comment,
        created_at: current_date,
      },
    });
    console.log("createdComment: ", createdComment);
    const serializedCreatedComment = {
      ...createdComment,
      id: Number(createdComment.id),
      case_id: Number(createdComment.case_id),
      treatment_id: Number(createdComment.treatment_id),
      user_id: Number(createdComment.user_id),
    };
    // Log the created comment for debugging

    logger.info("createdComment:", createdComment);
    res.status(201).json({
      message: "Comment added successfully.",
      data: serializedCreatedComment,
    });
  } catch (error) {
    logger.error("Failed to add comment:", error);
    res.status(500).json({ error: "Failed to add comment." });
  }
});

exports.getAllComments = asyncHandler(async (req, res) => {
  const { case_id, treatment_id } = req.params;

  const currentUserId = req.session?.userId;

  if (!case_id || !treatment_id) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  try {
    const comments = await prisma.treatment_comments.findMany({
      where: {
        case_id: BigInt(case_id),
        treatment_id: BigInt(treatment_id),
      },
      include: {
        users: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            role_id: true, // Include role_id from the users table
          },
        },
      },
      orderBy: {
        created_at: "asc", // Ensure comments are sorted by creation time
      },
    });

    const serializedComments = comments.map((comment) => {
      const isCurrentUser =
        currentUserId && Number(comment.user_id) === Number(currentUserId);

      // Combine first_name + last_name into a single sender_name
      const senderName =
        `${comment.users.first_name} ${comment.users.last_name}`.trim();

      return {
        id: Number(comment.id),
        case_id: Number(comment.case_id),
        treatment_id: Number(comment.treatment_id),
        user_id: Number(comment.user_id),
        comment: comment.comment,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        users: {
          id: Number(comment.users.id),
          first_name: comment.users.first_name,
          last_name: comment.users.last_name,
          role_id: Number(comment.users.role_id),
          sender_name: senderName, // new field
          is_current_user: isCurrentUser, // new field
        },
      };
    });

    res.status(200).json(serializedComments);
  } catch (error) {
    console.error(error);
    logger.error("Failed to fetch comments:", error);
    res.status(500).json({ error: "Failed to fetch comments." });
  }
});

// Get the latest treatment by case ID, along with all its orders (grouped by treatment_number)
exports.getLatestTreatmentByCaseId = asyncHandler(async (req, res) => {
  const { caseId } = req.params;

  // Step 1: Find the highest treatment_number for the given case_id
  const latestTreatmentNumber = await prisma.treatments.findFirst({
    where: {
      case_id: BigInt(caseId),
    },
    orderBy: {
      treatment_number: "desc",
    },
    select: {
      treatment_number: true,
    },
  });

  if (!latestTreatmentNumber) {
    logger.warn({ caseId }, "No treatments found for this case");
    throw new NotFoundError("No treatments found for this case");
  }

  // Step 2: Retrieve all treatments with the latest treatment_number, ordered by treatment_order
  const treatmentsWithLatestNumber = await prisma.treatments.findMany({
    where: {
      case_id: BigInt(caseId),
      treatment_number: latestTreatmentNumber.treatment_number, // Fetch treatments with the latest treatment_number
    },
    orderBy: {
      treatment_order: "asc", // Fetch all treatments ordered by treatment_order
    },
  });

  if (!treatmentsWithLatestNumber || treatmentsWithLatestNumber.length === 0) {
    logger.warn({ caseId }, "No order found for this treatment");
    throw new NotFoundError("No order found for this treatment");
  }

  // Convert BigInt fields to strings for all treatments
  const treatmentsResponse = treatmentsWithLatestNumber.map((treatment) => ({
    ...treatment,
    id: treatment.id.toString(),
    case_id: treatment.case_id.toString(),
    treatment_number: treatment.treatment_number.toString(),
  }));

  logger.info(
    { caseId, count: treatmentsResponse.length },
    "Latest treatments retrieved"
  );
  return new SuccessResponse(treatmentsResponse).send(res);
});

// Get treatment images by treatment ID, treatment number, and treatment order
exports.getTreatmentsImages = asyncHandler(async (req, res) => {
  const { treatmentId } = req.params;

  try {
    // Step 1: Get the treatment and its details (including treatment_number and treatment_order)
    const treatment = await prisma.treatments.findUnique({
      where: { id: BigInt(treatmentId) },
    });

    if (!treatment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Treatment not found" });
    }

    const { treatment_order, treatment_number } = treatment; // Extract treatment_number and treatment_order

    // Step 2: Use the treatment_id, treatment_number, and treatment_order to fetch the intraoral images
    const TreatmentImages = await prisma.patientIntraOralImages.findUnique({
      where: {
        treatment_id_treatment_number_treatment_order: {
          treatment_id: BigInt(treatmentId), // Ensure treatment_id is passed as BigInt
          treatment_number: BigInt(treatment_number), // Ensure treatment_number is passed as BigInt
          treatment_order: treatment_order, // Use the extracted treatment order
        },
      },
    });

    if (!TreatmentImages) {
      return res
        .status(404)
        .json({ status: "fail", message: "No treatment images found" });
    }

    // Convert BigInt fields to numbers for the response
    const sanitizeTreatmentImages = {
      ...TreatmentImages,
      id: Number(TreatmentImages.id),
      treatment_id: Number(TreatmentImages.treatment_id),
      treatment_number: Number(TreatmentImages.treatment_number),
      treatment_order: Number(TreatmentImages.treatment_order),
    };

    res.status(200).json({ status: "success", data: sanitizeTreatmentImages });
  } catch (error) {
    res.status(500).json({ status: "fail", message: error.message });
  }
});

// Get STL files for a given treatment by treatment ID
exports.getTreatmentSTLs = asyncHandler(async (req, res) => {
  const { treatmentId } = req.params;

  try {
    // Step 1: Retrieve the treatment and its related STL files
    const treatmentSTLs = await prisma.generatedSTLS.findUnique({
      where: { treatment_id: BigInt(treatmentId) }, // Ensure treatment_id is passed as BigInt
    });

    if (!treatmentSTLs) {
      return res.status(404).json({ message: "Treatment STLs not found" });
    }

    // Step 2: Extract STL file URLs from the result
    let stlUrls = {};
    for (let i = 1; i <= 3; i++) {
      const stlKey = `stl_file_${i}_link`;
      stlUrls[stlKey] = treatmentSTLs[stlKey] || null;
    }

    // Convert BigInt fields to numbers before sending the response
    const sanitizedSTLs = {
      ...stlUrls,
      id: Number(treatmentSTLs.id),
      treatment_id: Number(treatmentSTLs.treatment_id), // Convert BigInt to number
      pictures_id: Number(treatmentSTLs.pictures_id), // If applicable, convert other BigInt fields
    };

    return res.status(200).json({ status: "success", data: sanitizedSTLs });
  } catch (err) {
    logger.error({ error: err.message }, "Error fetching treatment STLs");
    return res.status(500).json({ message: "Internal server error." });
  }
});

// Update a specific image in patientIntraOralImages
exports.updateIntraOralImage = asyncHandler(async (req, res) => {
  const {
    treatmentId,
    treatmentNumber,
    treatmentOrder,
    imageSlot,
    screenshotLink,
  } = req.body;

  // Validation (Ensure the image slot is valid)
  if (
    ![
      "image_1_link",
      "image_2_link",
      "image_3_link",
      "image_4_link",
      "image_5_link",
    ].includes(imageSlot)
  ) {
    return res
      .status(400)
      .json({ status: "fail", message: "Invalid image slot" });
  }

  // Update the patientIntraOralImages with the selected screenshot
  const updatedIntraOralImage = await prisma.patientIntraOralImages.update({
    where: {
      treatment_id_treatment_number_treatment_order: {
        treatment_id: BigInt(treatmentId),
        treatment_number: BigInt(treatmentNumber),
        treatment_order: treatmentOrder,
      },
    },
    data: {
      [imageSlot]: screenshotLink, // Dynamically update the image slot
    },
  });

  return res
    .status(200)
    .json({ status: "success", data: updatedIntraOralImage });
});

// Remove a specific image in patientIntraOralImages
exports.removeIntraOralImage = asyncHandler(async (req, res) => {
  const { treatmentId } = req.params; // Fetch treatmentId from req.params
  const { imageSlot } = req.body; // The image slot to be removed (e.g., 'image_1_link')

  // Validation: Ensure the image slot is valid
  if (
    ![
      "image_1_link",
      "image_2_link",
      "image_3_link",
      "image_4_link",
      "image_5_link",
    ].includes(imageSlot)
  ) {
    return res
      .status(400)
      .json({ status: "fail", message: "Invalid image slot" });
  }

  try {
    // Step 1: Fetch the treatment details
    const treatment = await prisma.treatments.findUnique({
      where: { id: BigInt(treatmentId) },
    });

    if (!treatment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Treatment not found" });
    }

    const { treatment_number, treatment_order } = treatment; // Extract treatment_number and treatment_order

    // Step 2: Update the patientIntraOralImages by setting the selected image slot to null
    const updatedIntraOralImage = await prisma.patientIntraOralImages.update({
      where: {
        treatment_id_treatment_number_treatment_order: {
          treatment_id: BigInt(treatmentId),
          treatment_number: BigInt(treatment_number),
          treatment_order: treatment_order,
        },
      },
      data: {
        [imageSlot]: null, // Set the selected image slot to null (i.e., remove the image)
      },
    });

    // Step 3: Return the updated patientIntraOralImages entry
    return res
      .status(200)
      .json({ status: "success", data: updatedIntraOralImage });
  } catch (error) {
    // Handle any errors
    return res.status(500).json({ status: "fail", message: error.message });
  }
});

exports.retakeVideo = asyncHandler(async (req, res) => {
  const { treatmentId } = req.params; // Fetch treatmentId from req.params
  const { videosToRemove } = req.body; // Videos to remove (e.g., ['video_without_aligners_link', 'video_with_aligners_link'])

  // Validation: Ensure the videosToRemove array contains valid video fields
  const validVideoFields = [
    "video_without_aligners_link",
    "video_with_aligners_link",
  ];
  const invalidFields = videosToRemove.filter(
    (video) => !validVideoFields.includes(video)
  );

  if (invalidFields.length > 0) {
    return res.status(400).json({
      status: "fail",
      message: "Invalid video fields provided",
      invalidFields,
    });
  }

  try {
    // Step 1: Fetch the treatment details
    const treatment = await prisma.treatments.findUnique({
      where: { id: BigInt(treatmentId) },
    });

    if (!treatment) {
      return res
        .status(404)
        .json({ status: "fail", message: "Treatment not found" });
    }
    logger.info("treatment", treatment);

    // Step 2: Prepare data for removing the videos by setting them to null
    const updateData = {};
    videosToRemove.forEach((videoField) => {
      updateData[videoField] = null;
    });

    // Step 3: Update the treatment and remove the specified videos
    const updatedTreatment = await prisma.treatments.update({
      where: { id: BigInt(treatmentId) },
      data: updateData,
    });
    logger.info("updatedTreatment", updatedTreatment);

    // Step 4: Fetch the patient's user_id from the patients table
    const casePatient = await prisma.cases.findUnique({
      where: {
        id: treatment.case_id, // Ensure that patient_id is properly referenced from the treatment
      },
      select: {
        patient_id: true,
      },
    });
    const patient = await prisma.patients.findUnique({
      where: {
        id: casePatient.patient_id, // Ensure that patient_id is properly referenced from the treatment
      },
      select: {
        user_id: true,
      },
    });

    if (!patient) {
      return res
        .status(404)
        .json({ status: "fail", message: "Patient not found" });
    }

    // Step 5: Notify the patient to retake the removed videos
    const removedVideos = videosToRemove
      .map((field) => {
        // Convert field names to human-readable format
        if (field === "video_without_aligners_link") {
          return "video without aligners";
        } else if (field === "video_with_aligners_link") {
          return "video with aligners";
        }
        return field.replace("_link", "");
      })
      .join(", ");

    const message = `Your ${removedVideos} has/have been removed. Please retake the video(s).`;

    logger.info("patient", patient);

    await prisma.notifications.create({
      data: {
        url_notif: Number(treatment.id).toString(),
        sender_id: req.session.id, // Assuming the sender is the doctor
        receiver_id: patient.user_id, // Notify the patient
        message: message,
        createdAt: new Date(),
      },
    });

    // Send Firebase Cloud Message using user-specific topic
    const payload = {
      notification: {
        title: message,
        body: message,
      },
      data: {
        treatmentId: treatmentId.toString(),
        type: "treatment_notification",
      },
      topic: `user_${patient.user_id}`,
    };

    await patientMessaging.send(payload);

    const sterilizedUpdatedTreatment = {
      ...updatedTreatment,
      id: Number(updatedTreatment.id),
      treatment_number: Number(updatedTreatment.treatment_number),
      case_id: Number(updatedTreatment.case_id),
    };

    // Step 6: Respond with the updated treatment data
    return res
      .status(200)
      .json({ status: "success", data: sterilizedUpdatedTreatment });
  } catch (error) {
    return res.status(500).json({ status: "fail", message: error.message });
  }
});

// ########################### Notifications ###########################

exports.createNotification = asyncHandler(async (req, res) => {
  try {
    const { sender_id, receiver_id, notificationMessage } = req.body;

    // Validate input
    if (!sender_id || !receiver_id || !notificationMessage) {
      return res.status(400).json({
        error:
          "Missing required fields: sender_id, receiver_id, or notificationMessage.",
      });
    }

    // Add the notification
    const notification = await prisma.notifications.create({
      data: {
        sender_id: BigInt(sender_id),
        receiver_id: BigInt(receiver_id),
        message: notificationMessage,
      },
    });

    const serializedNotification = {
      ...notification,
      id: Number(notification.id),
      sender_id: Number(notification.sender_id),
      receiver_id: Number(notification.receiver_id),
    };

    res.status(201).json({
      status: "success",
      message: "Notification created successfully.",
      data: serializedNotification,
    });
  } catch (error) {
    logger.error("Error creating notification:", error);
    res
      .status(500)
      .json({ error: "Failed to create notification", details: error.message });
  }
});

exports.getNotifications = asyncHandler(async (req, res) => {
  try {
    const { receiver_id } = req.params;

    // Validate input
    if (!receiver_id) {
      return res.status(400).json({ error: "Missing receiver_id parameter." });
    }

    // Fetch notifications for the receiver
    const notifications = await prisma.notifications.findMany({
      where: { receiver_id: BigInt(receiver_id) },
      select: {
        id: true,
        sender_id: true,
        receiver_id: true,
        message: true,
        createdAt: true,
        checked: true,
      },
      orderBy: {
        createdAt: "desc", // Fetch notifications in descending order of creation
      },
    });

    if (!notifications.length) {
      return res.status(404).json({
        data: notifications,
        error: "No notifications found for this receiver.",
      });
    }

    const serializedNotifications = notifications.map((notification) => ({
      ...notification,
      id: Number(notification.id),
      sender_id: Number(notification.sender_id),
      receiver_id: Number(notification.receiver_id),
    }));

    res.status(200).json({
      status: "success",
      data: serializedNotifications,
    });
  } catch (error) {
    logger.error("Error fetching notifications:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch notifications", details: error.message });
  }
});
exports.markNotificationAsChecked = asyncHandler(async (req, res) => {
  try {
    const { notification_id } = req.params;

    // Validate input
    if (!notification_id) {
      return res
        .status(400)
        .json({ error: "Missing notification_id parameter." });
    }

    // Update the `checked` column to `true`
    const updatedNotification = await prisma.notifications.update({
      where: { id: BigInt(notification_id) },
      data: { checked: true },
    });

    res.status(200).json({
      status: "success",
      message: "Notification marked as checked.",
      data: {
        ...updatedNotification,
        id: Number(updatedNotification.id),
        sender_id: Number(updatedNotification.sender_id),
        receiver_id: Number(updatedNotification.receiver_id),
        checked: updatedNotification.checked,
      },
    });
  } catch (error) {
    logger.error("Error marking notification as checked:", error);
    res.status(500).json({
      error: "Failed to mark notification as checked",
      details: error.message,
    });
  }
});
