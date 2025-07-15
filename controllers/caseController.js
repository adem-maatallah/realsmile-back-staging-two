const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());
const {
  uploadFiles,
  extractImagesHandle,
  uploadSingleFile,
} = require("../utils/googleCDN");
const multer = require("multer");
const {
  extractImages,
  extractSTLs,
  extractPatientLinks,
  default_case_data,
  extractSingleImage,
  generatePdfForCase,
  generateInvoicePdf,
} = require("../utils/caseUtils");
const { sanitizeCaseDataList } = require("../utils/jsonUtils");
const {
  statusMap,
  statusDbEnum,
  caseTypeDbEnum,
  statusFrontendEnum,
  caseTypeMap,
} = require("../enums/caseEnum");
const {
  adminLinkStatusMap,
  generalLinkStatusMap,
} = require("../enums/iiwglEnum");
const upload = multer({ storage: multer.memoryStorage() });
const cpUpload = upload.fields([
  { name: "images", maxCount: 10 },
  { name: "stls", maxCount: 10 },
  { name: "image", maxCount: 1 },
  { name: "stl", maxCount: 1 }, // Add this line to handle single image uploads
]);
const aiImageUpload = upload.fields([{ name: "image", maxCount: 10 }]);
const bcrypt = require("bcrypt");
const admin = require("firebase-admin");
const { Mutex } = require("async-mutex");
const imagesMutexes = new Map();
const stlsMutexes = new Map();
const {
  differenceInSeconds,
  addSeconds,
  formatDistanceToNow,
} = require("date-fns");
const logger = require("../utils/logger");
const patient_image_url = "https://realsmilealigner.com/uploads/thumbnail/";
const doctor_image_url = "https://realsmilealigner.com/upload/";
const fs = require("fs");
const { doc, updateDoc, arrayUnion, getDoc } = require("firebase/firestore");
const { db } = require("../firebase/getData");
const queueEmail = require("../utils/email");
const dayjs = require("dayjs");
const redisClient = require("../utils/redis");
const additionalImagesUpload = upload.fields([
  { name: "images", maxCount: 10 },
]);
const Queue = require("bull");
const queueImageGeneration = require("../utils/queueImageGeneration");

const imageGenerationQueue = new Queue("imageGenerationQueue", {
  redis: {
    host: process.env.DB_HOST, // Adjust as necessary
    port: 6379,
  },
});

const serializeBigInt = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  } else if (obj !== null && typeof obj === "object") {
    if (obj instanceof Date) {
      // Convert Date object to ISO string
      return obj.toISOString();
    }
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
    );
  } else if (typeof obj === "bigint") {
    return obj.toString();
  } else {
    return obj;
  }
};

exports.getCases = async (req, res) => {
  try {
    const {
      patientId,
      doctorId,
      page = 1,
      perPage = 10,
      fetchAll,
      caseStatus,
    } = req.query;
    const shouldPaginate = !fetchAll || fetchAll.toLowerCase() !== "true";
    const { role, id: commercialId } = req.user;

    // Pagination options
    const paginationOptions = shouldPaginate
      ? {
          skip: (parseInt(page) - 1) * parseInt(perPage),
          take: parseInt(perPage),
        }
      : {};

    // If user role is commercial, enforce rules
    if (role === "commercial") {
      if (!doctorId) {
        return res.status(401).json({
          message: "doctorId is required.",
        });
      }

      // Check if doctorId belongs to the current commercial
      const doctor = await prisma.doctors.findFirst({
        where: {
          user_id: parseInt(doctorId),
          user: {
            commercial_id: commercialId,
          },
        },
      });

      if (!doctor) {
        return res.status(401).json({
          message: "You are not authorized to access cases for this doctor.",
        });
      }
    }

    // Build where options for cases
    let whereOptions = {
      ...(patientId && {
        patient: {
          user_id: parseInt(patientId),
        },
      }),
      ...(doctorId && {
        doctor: {
          user_id: parseInt(doctorId),
        },
      }),
      ...(caseStatus === "needs_approval" && {
        is_refused: {
          not: 1, // Exclude cases where is_refused = 1 for "needs_approval"
        },
      }),
      before_image_url: null,
      after_image_url: null,
    };

    let casesData = await prisma.cases.findMany({
      where: whereOptions,
      include: {
        patient: {
          select: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
                profile_pic: true,
              },
            },
          },
        },
        doctor: {
          select: {
            user: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                phone: true,
                profile_pic: true,
              },
            },
          },
        },
        status_histories: {
          orderBy: { id: "desc" },
          take: 1,
          select: {
            name: true,
            created_at: true,
          },
        },
        devis: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: {
            id: true,
          },
        },
        invoices: {
          select: {
            id: true,
          },
        },
        labo_links: {
          select: {
            video_id: true,
          },
        },
      },
      orderBy: { id: "desc" },
      ...paginationOptions,
      cacheStrategy: {
        ttl: 30,
        swr: 60,
      },
    });

    // Filter cases if caseStatus is provided
    if (caseStatus) {
      casesData = casesData.filter(
        (c) =>
          c.status_histories.length > 0 &&
          c.status_histories[0].name === caseStatus
      );
    }

    const cases = casesData.map((caseData) => {
      // Determine status
      const status =
        caseData.before_image_url && caseData.after_image_url
          ? "RealSmile AI"
          : statusMap[caseData.status_histories[0]?.name] || "Status Unknown";

      // Determine if incomplete
      const isIncomplete = caseData.status_histories[0]?.name === "incomplete";

      return {
        id: caseData.id.toString(),
        status,
        status_created_at: caseData.status_histories[0]?.created_at
          ? new Date(caseData.status_histories[0].created_at).toISOString()
          : null,
        created_at: new Date(caseData.created_at).toISOString(),
        patient: {
          name: `${caseData.patient.user.first_name} ${caseData.patient.user.last_name}`,
          avatar:
            extractSingleImage(
              caseData.patient?.user?.profile_pic,
              patient_image_url
            ) ||
            "https://storage.googleapis.com/realsmilefiles/staticFolder/patientCompress.png",
          phone: caseData.patient.user.phone || "Non spécifié",
        },
        doctor: {
          user: {
            id: caseData.doctor.user.id.toString(),
          },
          name: `${caseData.doctor.user.first_name} ${caseData.doctor.user.last_name}`,
          avatar:
            extractSingleImage(
              caseData.doctor?.user?.profile_pic,
              doctor_image_url
            ) ||
            "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png",
          phone: caseData.doctor.user.phone || "Non Spécifié",
        },
        note: caseData.note || "",
        devis: caseData.devis[0]?.id ? caseData.devis[0].id.toString() : null,
        hasInvoice: caseData.invoices.length > 0,
        video_id: caseData.labo_links?.[0]?.video_id || null,
        type: caseTypeMap[caseData.case_type] || "Type de cas inconnu",
        is_refused: caseData.is_refused, // Include the is_refused field
        treatment_exists: caseData.treatment_exists || false, // Include the treatment_exists field
        treatment_started: caseData.treatment_started || false, // Include the treatment_started field

        // New boolean field
        incomplete: isIncomplete,
      };
    });

    return res.status(200).json({ cases, totalCount: cases.length });
  } catch (error) {
    console.error("Error fetching cases:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getRealSmileAICases = async (req, res) => {
  try {
    const { role, id: userId } = req.user;

    // Build where condition
    let whereOptions = {
      after_image_url: { not: null }, // Only fetch cases with after_image_url not null
    };

    if (role === "doctor") {
      if (!userId) {
        return res.status(401).json({
          message: "userId is required.",
        });
      }

      await prisma.doctors.findFirst({
        where: {
          user_id: parseInt(userId),
        },
      });

      whereOptions.doctor = { user_id: parseInt(userId) };
    }

    const completedCases = await prisma.cases.findMany({
      where: whereOptions,
      include: {
        patient: {
          select: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                profile_pic: true,
                email: true,
              },
            },
          },
        },
        doctor: {
          select: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                profile_pic: true,
                email: true,
              },
            },
          },
        },
        // Include the latest status history record (ordered by its date)
        status_histories: {
          orderBy: { created_at: "desc" }, // adjust field if needed
          take: 1,
          select: { name: true },
        },
      },
      orderBy: { id: "desc" },
    });

    const cases = completedCases.map((caseData) => {
      // Get the most recent status history record (if any)
      const latestStatusHistory = caseData.status_histories[0];
      // Check if it's incomplete
      const isStatusHistoryIncomplete =
        latestStatusHistory?.name == "incomplete";

      return {
        id: caseData.id.toString(),
        created_at: new Date(caseData.created_at).toISOString(),
        before_image_url: caseData.before_image_url,
        after_image_url: caseData.after_image_url,
        patient: {
          email: caseData.patient.user.email,
          name: `${caseData.patient.user.first_name} ${caseData.patient.user.last_name}`,
          avatar:
            caseData.patient.user.profile_pic ||
            "https://storage.googleapis.com/realsmilefiles/staticFolder/patientCompress.png",
        },
        doctor: {
          name: `${caseData.doctor.user.first_name} ${caseData.doctor.user.last_name}`,
          avatar:
            caseData.doctor.user.profile_pic ||
            "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png",
          email: caseData.doctor.user.email,
        },
        isStatusHistoryIncomplete, // true if latest status history is incomplete
      };
    });

    return res.status(200).json({ cases, totalCount: cases.length });
  } catch (error) {
    console.error("Error fetching completed cases:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getLaboCases = async (req, res) => {
  try {
    const { page = 1, perPage = 10, fetchAll } = req.query;
    const shouldPaginate = !fetchAll || fetchAll.toLowerCase() !== "true";
    const paginationOptions = shouldPaginate
      ? {
          take: parseInt(perPage),
          skip: (parseInt(page) - 1) * parseInt(perPage),
        }
      : {};

    const findManyOptions = {
      where: {
        NOT: { case_type: "C" }, // Exclude cases with type 'C'
      },
      select: {
        id: true,
        created_at: true,
        note: true,
        patient_id: true,
        case_type: true, // Include case_type for further filtering
        patient: {
          select: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                profile_pic: true,
              },
            },
          },
        },
        status_histories: {
          orderBy: { created_at: "desc" }, // Order by created_at to get the latest status
          take: 1, // Take the most recent status
          select: {
            name: true,
            created_at: true,
          },
        },
        labo_links: {
          orderBy: { created_at: "desc" },
          take: 1, // Take the most recent lab link
          select: {
            admin_validation_status: true,
            doctor_validation_status: true,
            created_at: true,
          },
        },
        patient_images: true, // Include patient_images for type 'R'
        patient_stls: true, // Include patient_stls for type 'R'
      },
      orderBy: {
        id: "desc",
      },
      ...paginationOptions,
    };

    const casesData = await prisma.cases.findMany(findManyOptions);

    const filteredCasesData = casesData.filter((caseItem) => {
      if (caseItem.case_type === "R") {
        const { patient_images, patient_stls } = caseItem;

        if (!patient_images || !patient_stls) {
          return false; // Skip if patient images or STLs are not found
        }

        const { custom_file_1, custom_file_2, custom_file_3 } = patient_stls;
        const { image1 } = patient_images;

        if (!image1 || !custom_file_1 || !custom_file_2 || !custom_file_3) {
          return false; // Skip if required custom files are missing for case type 'R'
        }
      }

      return (
        caseItem.status_histories.length > 0 &&
        (caseItem.status_histories[0].name === statusDbEnum.pending ||
          caseItem.status_histories[0].name === statusDbEnum.needs_approval)
      );
    });

    const currentTime = new Date();
    const cases = [];

    for (const caseItem of filteredCasesData) {
      const latestStatus = caseItem.status_histories[0];
      const latestLabLink =
        caseItem.labo_links.length > 0 ? caseItem.labo_links[0] : null;

      if (latestStatus) {
        const latestStatusCreatedAtString = latestStatus.created_at;
        const latestStatusCreatedAt = new Date(latestStatusCreatedAtString);

        if (isNaN(latestStatusCreatedAt.getTime())) {
          console.error("Invalid date format:", latestStatusCreatedAtString);
          continue; // Skip this iteration if the date is not valid
        }

        const secondsDifference = differenceInSeconds(
          currentTime,
          latestStatusCreatedAt
        );
        const thresholdSeconds = 86400; // 24 hours in seconds

        const isLate =
          latestStatus.name === statusDbEnum.pending &&
          (!latestLabLink ||
            latestLabLink.admin_validation_status ===
              generalLinkStatusMap.rejected ||
            latestLabLink.doctor_validation_status ===
              generalLinkStatusMap.rejected) &&
          secondsDifference >= thresholdSeconds;

        const lateTime = isLate
          ? Math.max(0, secondsDifference - thresholdSeconds)
          : null;
        const remainingTime =
          !isLate && latestStatus.name === statusDbEnum.pending
            ? differenceInSeconds(
                addSeconds(latestStatusCreatedAt, thresholdSeconds),
                currentTime
              )
            : null;

        const requireSmileSetUpload =
          latestStatus.name === statusDbEnum.pending &&
          (!latestLabLink ||
            latestLabLink.admin_validation_status ===
              generalLinkStatusMap.rejected ||
            latestLabLink.doctor_validation_status ===
              generalLinkStatusMap.rejected)
            ? "Missing link"
            : "Done";

        cases.push({
          id: caseItem.id.toString(),
          created_at: new Date(caseItem.created_at).toISOString(),
          note: caseItem.note || "general instruction is not specified",
          patient: {
            name: `${caseItem.patient.user.first_name} ${caseItem.patient.user.last_name}`,
            avatar:
              extractSingleImage(
                caseItem.patient.user.profile_pic,
                patient_image_url
              ) || "defaultAvatarURL",
          },
          require_smile_set_upload: requireSmileSetUpload,
          isLate: latestStatus.name === statusDbEnum.pending ? isLate : null,
          time:
            latestStatus.name === statusDbEnum.pending
              ? isLate
                ? lateTime
                : remainingTime
              : null,
        });
      }
    }

    const sortedCases = cases.sort((a, b) =>
      a.require_smile_set_upload === "Missing link" &&
      b.require_smile_set_upload !== "Missing link"
        ? -1
        : b.require_smile_set_upload === "Missing link" &&
          a.require_smile_set_upload !== "Missing link"
        ? 1
        : 0
    );

    const totalCount = shouldPaginate
      ? await prisma.cases.count({ where: { NOT: { case_type: "C" } } })
      : sortedCases.length;

    return res.status(200).json({ cases: sortedCases, totalCount });
  } catch (error) {
    console.error("Error fetching cases:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getLaboCasesTreatmentStatus = async (req, res) => {
  try {
    const { page = 1, perPage = 10, fetchAll } = req.query;
    const shouldPaginate = !fetchAll || fetchAll.toLowerCase() !== "true";
    const paginationOptions = shouldPaginate
      ? {
          take: parseInt(perPage),
          skip: (parseInt(page) - 1) * parseInt(perPage),
        }
      : {};

    const findManyOptions = {
      where: {},
      select: {
        id: true,
        created_at: true,
        status_histories: {
          orderBy: { id: "desc" },
          take: 1, // Take the most recent status
          select: {
            name: true,
            created_at: true,
          },
        },
      },
      orderBy: {
        id: "desc", // Orders the results by id in descending order
      },
      ...paginationOptions,
    };

    const casesData = await prisma.cases.findMany(findManyOptions);

    const currentTime = new Date();
    const treatmentStatuses = [];

    for (const caseItem of casesData) {
      if (caseItem.status_histories.length > 0) {
        const latestStatus = caseItem.status_histories[0];
        if (latestStatus.name === "needs_approval") {
          const latestStatusCreatedAtString = latestStatus.created_at;
          const latestStatusCreatedAt = new Date(latestStatusCreatedAtString);
          const hoursDifference = differenceInHours(
            currentTime,
            latestStatusCreatedAt
          );
          const isLate = hoursDifference >= 24;
          const lateTime = isLate ? hoursDifference : null;
          const remainingTime = !isLate
            ? formatDistanceToNow(addHours(latestStatusCreatedAt, 24))
            : 0;
          treatmentStatuses.push({
            caseId: caseItem.id.toString(),
            isLate,
            lateTime,
            remainingTime,
          });
        }
      }
    }

    return res.status(200).json({ treatmentStatuses });
  } catch (error) {
    console.error("Error fetching cases:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getCaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const { user } = req; // Assumes `user` is available from request context

    if (!id || !id.trim() || isNaN(id)) {
      return res.status(400).json({ message: "Invalid case ID provided." });
    }

    const caseIdInt = BigInt(id);

    // Define base query for labo_links based on user role
    let laboLinksQuery = {
      orderBy: { id: "desc" },
    };

    // Customize query for labo_links based on whether the user is a doctor or admin
    if (user.role === "doctor") {
      laboLinksQuery.where = {
        validated_by_admin: { not: null },
        admin_validation_status: "accepted",
      };
    }

    let caseData = await prisma.cases.findUnique({
      where: { id: caseIdInt },
      include: {
        patient: {
          include: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
                email: true,
                profile_pic: true,
              },
            },
            patient_images: true,
          },
        },
        doctor: {
          select: {
            speciality: true, // Fetch the doctor's specialty
            user: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                phone: true,
                email: true,
                profile_pic: true,
              },
            },
          },
        },
        patient_stls: true,
        labo_links: laboLinksQuery,
        patient_images: true,
        status_histories: {
          orderBy: { id: "desc" },
        },
        packs: {
          select: {
            name: true,
          },
        },
        devis: {
          orderBy: { id: "desc" },
          take: 1,
        },
      },
    });

    if (!caseData) {
      return res.status(404).json({ message: "Case not found." });
    }

    // Check if the request user is allowed to access the case
    if (
      req.user.role !== "admin" &&
      req.user.role !== "hachem" &&
      req.user.role !== "commercial" &&
      req.user.id !== caseData.doctor?.user.id
    ) {
      return res
        .status(403)
        .json({ message: "You are not allowed to access this case." });
    }

    // If the user has the role 'hachem', ensure the case status is 'in_construction'
    const latestStatus =
      caseData.status_histories.length > 0
        ? caseData.status_histories[0].name
        : "Status Unknown";
    const latestStatusCreatedAt =
      caseData.status_histories.length > 0
        ? caseData.status_histories[0].created_at
        : "Unknown";
    if (req.user.role === "hachem" && latestStatus !== "in_construction") {
      return res
        .status(403)
        .json({ message: "You are not allowed to access this case." });
    }

    // Check condition for case type "R"
    if (caseData.case_type === "R") {
      const { patient_images, patient_stls } = caseData;

      if (!patient_images || !patient_stls) {
        return res.status(409).json({
          message: "Patient images or patient STLs not found.",
          caseId: caseIdInt.toString(),
        });
      }

      const { image1 } = patient_images;
      const { custom_file_1, custom_file_2, custom_file_3 } = patient_stls;

      if (!image1 || !custom_file_1 || !custom_file_2 || !custom_file_3) {
        console.log(
          "Required images or custom files are missing for case type 'R'."
        );
        return res.status(409).json({
          message:
            "Required images and custom files are missing for case type 'R'.",
          caseId: caseIdInt.toString(),
        });
      }
    }

    let linkedCases = [];
    if (caseData.case_type === "N") {
      // If it's a root case, fetch its linked cases
      const subCases = await prisma.caseAssociation.findMany({
        where: { case_id: caseIdInt },
        select: {
          linked_cases: {
            select: {
              id: true,
              created_at: true,
              case_type: true,
            },
          },
          order: true,
        },
        orderBy: { order: "asc" },
      });

      if (subCases) {
        linkedCases = subCases.map((subCase, index) => ({
          id: subCase.linked_cases.id.toString(),
          created_at: new Date(subCase.linked_cases.created_at).toISOString(),
          type: subCase.linked_cases.case_type,
          order: index + 2, // Start sub-cases order from 2
        }));
      }

      // Add the root case as order 1
      linkedCases.unshift({
        id: caseData.id.toString(),
        created_at: new Date(caseData.created_at).toISOString(),
        type: caseData.case_type,
        order: 1,
      });
    } else {
      // If it's a sub-case, find the root case and its linked cases
      const rootAssociation = await prisma.caseAssociation.findFirst({
        where: { linked_case_id: caseIdInt },
        include: {
          cases: true,
        },
      });

      if (!rootAssociation) {
        return res.status(404).json({ message: "Root case not found" });
      }

      const rootCaseId = rootAssociation.case_id;

      const subCases = await prisma.caseAssociation.findMany({
        where: { case_id: rootCaseId },
        select: {
          linked_cases: {
            select: {
              id: true,
              created_at: true,
              case_type: true,
            },
          },
          order: true,
        },
        orderBy: { order: "asc" },
      });

      if (subCases) {
        linkedCases = subCases.map((subCase, index) => ({
          id: subCase.linked_cases.id.toString(),
          created_at: new Date(subCase.linked_cases.created_at).toISOString(),
          type: subCase.linked_cases.case_type,
          order: index + 2, // Start sub-cases order from 2
        }));
      }

      // Add the root case as order 1
      const rootCaseData = await prisma.cases.findUnique({
        where: { id: rootCaseId },
        select: {
          id: true,
          created_at: true,
          case_type: true,
        },
      });

      if (rootCaseData) {
        linkedCases.unshift({
          id: rootCaseData.id.toString(),
          created_at: new Date(rootCaseData.created_at).toISOString(),
          type: rootCaseData.case_type,
          order: 1,
        });
      }
    }

    const latestDevis =
      caseData.devis.length > 0 ? caseData.devis[0].id : "null";

    const responseData = {
      actual_case_id: id.toString(),
      patient_name: caseData.patient?.user
        ? `${caseData.patient.user.first_name} ${caseData.patient.user.last_name}`
        : "Unknown",
      patient_phone: caseData.patient?.user?.phone || "pas de numéro",
      patient_email: caseData.patient?.user?.email || "Unknown@gmail.com",
      profile_pic:
        extractSingleImage(
          caseData.patient?.user?.profile_pic,
          patient_image_url
        ) ||
        "https://realsmilealigner.com/uploads/thumbnail/case/1507/16877.png",
      created_at: caseData.created_at,
      note: caseData.note || "Cause non spécifiée",
      case_status: statusMap[latestStatus],
      case_status_created_at: latestStatusCreatedAt,
      case_type: caseTypeMap[caseData.case_type],
      pack_name: caseData.packs?.name || "SmileSet non approuvé par l'admin.",
      shipping_link: caseData.shipping_link || "Pas de lien de suivi",
      id: id.toString(),
      images: extractImages(caseData.patient_images, patient_image_url),
      stls: extractSTLs(caseData.patient_stls),
      links: extractPatientLinks(caseData.labo_links || []),
      linkedCases,
      status_histories: caseData.status_histories.map((history) => ({
        status: statusMap[history.name],
        created_at: history.created_at,
      })),
      general_instructions: caseData.general_instructions,
      arch_selection: caseData.arch_selection,
      latest_devis_id: latestDevis.toString(),
      additional_images: caseData.patient_images?.additional_images
        ? JSON.parse(caseData.patient_images.additional_images)
        : [],
      is_refused: caseData.is_refused,
      doctor_information: caseData.doctor?.user
        ? {
            id: caseData.doctor.user.id,
            first_name: caseData.doctor.user.first_name,
            last_name: caseData.doctor.user.last_name,
            phone: caseData.doctor.user.phone,
            email: caseData.doctor.user.email,
            profile_pic: caseData.doctor.user.profile_pic,
            speciality: caseData.doctor.speciality,
          }
        : "No doctor information available",
    };

    // Add smile_summary and movement_chart_summary if created_at is before May 15, 2024
    const cutoffDate = new Date("2024-05-15");
    if (caseData.created_at < cutoffDate) {
      responseData.smile_summary =
        "https://realsmilealigner.com/" + caseData.smile_summary ||
        "No summary available";
      responseData.movement_chart_summary =
        "https://realsmilealigner.com/" + caseData.movement_chart_summary ||
        "No chart summary available";
    }

    const serializedResponse = serializeBigInt(responseData);

    return res.status(200).json(serializedResponse);
  } catch (error) {
    console.error("Error fetching case by ID:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.createCaseWithPatientData = async (req, res) => {
  cpUpload(req, res, async (error) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const {
      firstname,
      lastname,
      dateofbirth,
      patient_id,
      gender,
      doctorId,
      note,
      email,
      phone,
      password,
      status = "incomplete", // Default to 'incomplete' if not provided
    } = req.body;
    const doctorIdInt = parseInt(doctorId);
    let patient, user, stlData, imageData;

    const doctor = await prisma.doctors.findFirst({
      where: { user_id: doctorIdInt },
    });

    const role = await prisma.roles.findFirst({
      where: { name: "patient" },
    });
    if (status && !(status in statusDbEnum)) {
      return res.status(400).json({ message: "Invalid status provided" });
    }

    const hashedPassword = await bcrypt.hash(
      password ? password : "password",
      10
    ); // Ensure bcrypt is installed and imported

    try {
      if (!patient_id) {
        user = await prisma.users.create({
          data: {
            first_name: firstname,
            last_name: lastname,
            email:
              email || `default@gmail${Math.floor(Math.random() * 10000)}.com`,
            phone: phone || `000${Math.floor(Math.random() * 10000)}`,
            password: hashedPassword,
            role: {
              connect: { id: role.id },
            },
            profile_pic:
              "https://storage.googleapis.com/realsmilefiles/staticFolder/patientCompress.png",
          },
        });

        patient = await prisma.patients.create({
          data: {
            first_name: firstname,
            last_name: lastname,
            date_of_birth: dateofbirth,
            gender: gender,
            doctor_id: doctor.id,
            user_id: parseInt(user.id),
          },
        });
      } else {
        patient = await prisma.patients.findUnique({
          where: { id: parseInt(patient_id) },
        });
        if (!patient) {
          return res.status(404).json({ message: "Patient not found" });
        }
      }

      const caseData = await prisma.cases.create({
        data: {
          patient_id: parseInt(patient.id),
          doctor_id: doctor.id,
          case_data: {},
          created_at: new Date(),
        },
      });

      // Record the status history
      await prisma.status_histories.create({
        data: {
          caseId: parseInt(caseData.id),
          name: status,
          created_at: new Date(),
        },
      });

      if (req.files) {
        if (req.files.images && req.files.images.length > 0) {
          const imageUploadResults = await uploadFiles(
            req.files.images,
            parseInt(caseData.id),
            process.env.GOOGLE_STORAGE_BUCKET_CASE_IMAGES
          );
          imageData = imageUploadResults.reduce((acc, imageUrl, index) => {
            acc[`image${index + 1}`] = imageUrl;
            return acc;
          }, {});

          imageData = await prisma.patient_images.create({
            data: {
              case_id: parseInt(caseData.id),
              patient_id: patient.id,
              ...imageData,
              created_at: new Date(),
            },
          });
        }

        if (req.files.stls && req.files.stls.length > 0) {
          const stlUploadResults = await uploadFiles(
            req.files.stls,
            parseInt(caseData.id),
            process.env.GOOGLE_STORAGE_BUCKET_CASE_STLS
          );
          stlData = stlUploadResults.reduce(
            (acc, fileUrl, index) => {
              acc[`custom_file_${index + 1}`] = fileUrl;
              return acc;
            },
            {
              case_id: parseInt(caseData.id),
              patient_id: patient.id,
              created_at: new Date(),
            }
          );

          stlData = await prisma.patient_stls.create({ data: stlData });
        }
      }

      res.status(201).json({
        message: "Case with patient data and files created successfully",
      });
    } catch (err) {
      console.error("Error in createCaseWithPatientData:", err);
      res.status(500).json({ error: err.message });
    }
  });
};

exports.getStep1InfoByCaseId = async (req, res) => {
  const { caseId } = req.params; // Getting the case ID from the URL parameter
  const caseIdInt = parseInt(caseId);

  // Validate case ID
  if (!caseId || isNaN(caseIdInt)) {
    return res.status(400).json({ message: "Invalid case ID provided" });
  }

  try {
    // Fetch the case, including patient details and related user details
    const caseInfo = await prisma.cases.findUnique({
      where: { id: caseIdInt },
      include: {
        patient: {
          include: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
                email: true,
              },
            },
          },
        },
        doctor: {
          include: {
            user: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!caseInfo) {
      return res.status(404).json({ message: "Case not found" });
    }

    if (req.user.role !== "admin" && req.user.id !== caseInfo.doctor?.user.id) {
      console.log(
        "You are not allowed to access this case.",
        caseInfo.doctor?.user.id
      );
      return res
        .status(403)
        .json({ message: "You are not allowed to access this case." });
    }

    // Fetch the most recent status history for the case
    const lastStatus = await prisma.status_histories.findFirst({
      where: { caseId: BigInt(caseId) },
      orderBy: { created_at: "desc" },
    });

    // Check if the last status is 'incomplete'
    if (lastStatus?.name !== "incomplete") {
      return res
        .status(400)
        .json({ message: "The case is not in an 'incomplete' status." });
    }

    // Construct the response with the necessary details
    return res.status(200).json({
      firstName: caseInfo.patient.user.first_name || "",
      lastName: caseInfo.patient.user.last_name || "",
      phone: caseInfo.patient.user.phone || "",
      email: caseInfo.patient.user.email || "",
      dateOfBirth: caseInfo.patient.date_of_birth || "",
      gender: caseInfo.patient.gender || "",
    });
  } catch (error) {
    console.error("Error fetching case by ID:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.stepOne = async (req, res) => {
  const { user: reqUser, body } = req;
  const {
    firstName,
    lastName,
    dateDeNaissance,
    sexe,
    password,
    profile_picture,
    caseId,
    doctorId,
    email,
  } = body;

  if (!firstName || !lastName || !dateDeNaissance || !sexe) {
    return res.status(400).json({ error: "Missing mandatory fields." });
  }

  const userEmail =
    email && email.trim() !== ""
      ? email
      : `default${Math.floor(Math.random() * 10000)}@gmail.com`;

  const doctorIdInt = doctorId ? parseInt(doctorId) : parseInt(reqUser.id);

  if (isNaN(doctorIdInt)) {
    return res.status(400).json({ error: "Invalid doctor ID" });
  }

  const hashedPassword = await bcrypt.hash(password || "password", 10);

  try {
    const result = await prisma.$transaction(
      async (prismaTransaction) => {
        const doctor = await prismaTransaction.doctors.findUnique({
          where: { user_id: doctorIdInt },
        });
        if (!doctor) throw new Error("Doctor not found");

        const role = await prismaTransaction.roles.findUnique({
          where: { name: "patient" },
        });
        if (!role) throw new Error("Patient role not found");

        let caseData;

        if (caseId) {
          // Update existing case if caseId is provided
          const parsedCaseId = parseInt(caseId, 10);
          if (isNaN(parsedCaseId)) throw new Error("Invalid case ID format");

          const existingCase = await prismaTransaction.cases.findUnique({
            where: { id: parsedCaseId },
            include: { patient: { include: { user: true } } },
          });
          if (!existingCase) throw new Error("Case not found");

          await prismaTransaction.users.update({
            where: { id: existingCase.patient.user.id },
            data: { first_name: firstName, last_name: lastName },
          });

          await prismaTransaction.patients.update({
            where: { id: existingCase.patient.id },
            data: { gender: sexe, date_of_birth: dateDeNaissance },
          });

          caseData = existingCase;
        } else {
          // Convert dateDeNaissance to a local date string
          const parsedDate = new Date(dateDeNaissance);
          if (isNaN(parsedDate.getTime())) {
            throw new Error("Invalid date format for dateDeNaissance");
          }

          // Find or create patient based on date string
          let patient = await prismaTransaction.patients.findFirst({
            where: {
              first_name: firstName,
              last_name: lastName,
              gender: sexe,
            },
            include: { user: true },
          });

          if (!patient) {
            const user = await prismaTransaction.users.create({
              data: {
                first_name: firstName,
                last_name: lastName,
                password: hashedPassword,
                created_at: new Date(),
                role_id: BigInt(role.id),
                profile_pic:
                  profile_picture ||
                  "https://storage.googleapis.com/realsmilefiles/staticFolder/patientCompress.png",
                email: userEmail,
                phone: null,
              },
            });

            patient = await prismaTransaction.patients.create({
              data: {
                user_id: BigInt(user.id),
                first_name: firstName,
                last_name: lastName,
                date_of_birth: parsedDate.toISOString(), // Store as ISO string
                gender: sexe,
                doctor_id: BigInt(doctor.id),
                created_at: new Date(),
              },
            });
          } else {
            await prismaTransaction.users.update({
              where: { id: patient.user_id },
              data: { first_name: firstName, last_name: lastName },
            });

            await prismaTransaction.patients.update({
              where: { id: patient.id },
              data: {
                first_name: firstName,
                last_name: lastName,
                date_of_birth: parsedDate.toISOString(), // Ensure stored consistently
                gender: sexe,
                doctor_id: BigInt(doctor.id),
                updated_at: new Date(),
              },
            });
          }

          // Check for existing cases with the same patient and doctor
          const existingCase = await prismaTransaction.cases.findFirst({
            where: {
              patient_id: BigInt(patient.id),
              doctor_id: BigInt(doctor.id),
            },
          });

          if (existingCase) {
            const latestStatusHistory =
              await prismaTransaction.status_histories.findFirst({
                where: { caseId: existingCase.id },
                orderBy: { created_at: "desc" },
              });

            if (
              latestStatusHistory &&
              latestStatusHistory.name === "incomplete"
            ) {
              // Return the existing case ID if the status is incomplete
              return { id: existingCase.id.toString() };
            }

            // If the last status isn't 'incomplete', throw an error
            throw new Error(
              "Vous avez déjà un cas avec ce patient, completez le cas existant."
            );
          }

          // Only create a new case if no incomplete case exists
          caseData = await prismaTransaction.cases.create({
            data: {
              patient_id: BigInt(patient.id),
              doctor_id: BigInt(doctor.id),
              created_at: new Date(),
              case_data: {},
            },
          });

          await prismaTransaction.status_histories.create({
            data: {
              name: statusDbEnum.incomplete,
              created_at: new Date(),
              caseId: BigInt(caseData.id),
            },
          });
        }

        return {
          id: caseData.id.toString(),
          personalizedPlan: caseData.personalized_plan,
          archSelection: caseData.arch_selection,
          generalInstructions: caseData.general_instructions,
          caseJsonData: caseData.case_data,
        };
      },
      {
        maxWait: 5000, // Maximum wait time before starting the transaction
        timeout: 15000, // Maximum time for a transaction to be completed
      }
    );

    res.status(201).json({
      message: "Case handled successfully",
      ...result,
    });
  } catch (err) {
    // Send an error response without circular references
    console.error("Error in handleCaseWithPatient:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};

exports.stepOneWithBeforeImage = async (req, res) => {
  aiImageUpload(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(500).json({ error: uploadError.message });
    }

    // Extract fields from the request body
    const { user: reqUser, body } = req;
    const {
      firstName,
      lastName,
      dateDeNaissance,
      sexe,
      password,
      profile_picture,
      caseId,
      doctorId,
      email,
    } = body;

    const userEmail =
      email && email.trim() !== ""
        ? email
        : `default${Math.floor(Math.random() * 10000)}@gmail.com`;

    const doctorIdInt = doctorId
      ? parseInt(doctorId, 10)
      : parseInt(reqUser.id, 10);
    if (isNaN(doctorIdInt)) {
      return res.status(400).json({ error: "Invalid doctor ID" });
    }

    const hashedPassword = await bcrypt.hash(password || "password", 10);
    console.log("Hashed password:", hashedPassword);
    try {
      // Create or update patient and case data in a transaction
      const result = await prisma.$transaction(
        async (tx) => {
          const doctor = await tx.doctors.findUnique({
            where: { user_id: doctorIdInt },
          });
          if (!doctor) throw new Error("Doctor not found");

          const role = await tx.roles.findUnique({
            where: { name: "patient" },
          });
          if (!role) throw new Error("Patient role not found");

          let caseData;

          if (caseId) {
            const parsedCaseId = parseInt(caseId, 10);
            if (isNaN(parsedCaseId)) throw new Error("Invalid case ID format");

            const existingCase = await tx.cases.findUnique({
              where: { id: parsedCaseId },
              include: { patient: { include: { user: true } } },
            });
            if (!existingCase) throw new Error("Case not found");

            await tx.users.update({
              where: { id: existingCase.patient.user.id },
              data: { first_name: firstName, last_name: lastName },
            });

            await tx.patients.update({
              where: { id: existingCase.patient.id },
              data: { gender: sexe, date_of_birth: dateDeNaissance },
            });

            caseData = existingCase;
          } else {
            const parsedDate = new Date(dateDeNaissance);
            if (isNaN(parsedDate.getTime())) {
              throw new Error("Invalid date format for dateDeNaissance");
            }

            let patient = await tx.patients.findFirst({
              where: {
                first_name: firstName,
                last_name: lastName,
                gender: sexe,
              },
              include: { user: true },
            });

            if (!patient) {
              const user = await tx.users.create({
                data: {
                  first_name: firstName,
                  last_name: lastName,
                  password: hashedPassword,
                  created_at: new Date(),
                  role_id: BigInt(role.id),
                  profile_pic:
                    profile_picture ||
                    "https://storage.googleapis.com/realsmilefiles/staticFolder/patientCompress.png",
                  email: userEmail,
                  phone: null,
                },
              });

              patient = await tx.patients.create({
                data: {
                  user_id: BigInt(user.id),
                  first_name: firstName,
                  last_name: lastName,
                  date_of_birth: parsedDate.toISOString(),
                  gender: sexe,
                  doctor_id: BigInt(doctor.id),
                  created_at: new Date(),
                },
              });
            } else {
              await tx.users.update({
                where: { id: patient.user_id },
                data: { first_name: firstName, last_name: lastName },
              });

              await tx.patients.update({
                where: { id: patient.id },
                data: {
                  first_name: firstName,
                  last_name: lastName,
                  date_of_birth: parsedDate.toISOString(),
                  gender: sexe,
                  doctor_id: BigInt(doctor.id),
                  updated_at: new Date(),
                },
              });
            }

            const existingCase = await tx.cases.findFirst({
              where: {
                patient_id: BigInt(patient.id),
                doctor_id: BigInt(doctor.id),
              },
            });

            caseData = await tx.cases.create({
              data: {
                patient_id: BigInt(patient.id),
                doctor_id: BigInt(doctor.id),
                created_at: new Date(),
                case_data: {},
              },
            });

            await tx.status_histories.create({
              data: {
                name: "incomplete",
                created_at: new Date(),
                caseId: BigInt(caseData.id),
              },
            });
          }

          return {
            id: caseData.id.toString(),
            personalizedPlan: caseData.personalized_plan,
            archSelection: caseData.arch_selection,
            generalInstructions: caseData.general_instructions,
            caseJsonData: caseData.case_data,
          };
        },
        { maxWait: 5000, timeout: 15000 }
      );

      const caseIdInt = parseInt(result.id, 10);
      console.log("Case ID:", caseIdInt);
      // Allowed MIME types: allow all images
      const allowedMimeTypesRegex = /^image\/.+$/;
      try {
        if (!req.files || !req.files.image || req.files.image.length !== 1) {
          throw new Error("Exactly one image must be provided.");
        }

        const file = req.files.image[0];
        if (!file.mimetype.match(allowedMimeTypesRegex)) {
          throw new Error("Invalid image type. Only image files are allowed.");
        }

        // Upload the file to Google Cloud Storage.
        const bucketName = process.env.GOOGLE_STORAGE_BUCKET_CASE_IMAGES;
        const imageUrl = await uploadSingleFile(file, result.id, bucketName);
        console.log("Image uploaded successfully:", imageUrl);
        // Update or create the patient_images record with image1.
        const existingImages = await prisma.patient_images.findUnique({
          where: { case_id: caseIdInt },
        });
        if (existingImages) {
          await prisma.patient_images.update({
            where: { case_id: caseIdInt },
            data: { image1: imageUrl },
          });
        } else {
          const caseRecord = await prisma.cases.findUnique({
            where: { id: caseIdInt },
          });
          await prisma.patient_images.create({
            data: {
              case_id: caseIdInt,
              patient_id: caseRecord.patient_id,
              image1: imageUrl,
              created_at: new Date(),
            },
          });
        }

        // Update the case record with the before_image_url.
        await prisma.cases.update({
          where: { id: caseIdInt },
          data: { before_image_url: imageUrl },
        });

        // If the uploaded image is the first image, update the patient's profile_pic.
        if (file.fieldname === "image") {
          const caseRecord = await prisma.cases.findUnique({
            where: { id: caseIdInt },
            include: { patient: true },
          });
          if (caseRecord && caseRecord.patient) {
            await prisma.users.update({
              where: { id: caseRecord.patient.user_id },
              data: { profile_pic: imageUrl },
            });
          }
        }

        // Add an image-generation job to the Redis queue via our helper function.
        const job = { caseId: caseIdInt, beforeImageUrl: imageUrl };
        console.log("job: ", job)
        await queueImageGeneration(job);

        return res.status(201).json({
          message:
            "Case handled successfully with image upload and job enqueued",
          caseId: result.id,
          imageUrl,
          status: true,
        });
      } catch (fileError) {
        throw fileError;
      }
    } catch (err) {
      console.error("Error in stepOneWithBeforeImage:", err.message);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message });
      }
    }
  });
};

exports.getCaseStatus = async (req, res) => {
  const { caseId } = req.params;
  if (!caseId) {
    return res.status(400).json({ error: "Case ID is required" });
  }

  try {
    const parsedCaseId = parseInt(caseId, 10);
    if (isNaN(parsedCaseId)) {
      return res.status(400).json({ error: "Invalid case ID" });
    }

    const caseRecord = await prisma.cases.findUnique({
      where: { id: parsedCaseId },
      include: {
        patient: {
          select: {
            first_name: true,
            last_name: true,
            date_of_birth: true,
            gender: true,
          },
        },
      },
    });

    if (!caseRecord) {
      return res.status(404).json({ error: "Case not found" });
    }

    const firstName = caseRecord.patient ? caseRecord.patient.first_name : null;
    const lastName = caseRecord.patient ? caseRecord.patient.last_name : null;
    const dateDeNaissance = caseRecord.patient
      ? caseRecord.patient.date_of_birth
      : null;
    const sexe = caseRecord.patient ? caseRecord.patient.gender : null;
    const beforeImageUrl = caseRecord.before_image_url || null;
    const afterImageUrl = caseRecord.after_image_url || null;

    let queuePosition = null;

    if (!afterImageUrl) {
      // Get all jobs in the waiting queue
      const waitingJobs = await imageGenerationQueue.getJobs([
        "waiting",
        "active",
      ]);
      queuePosition = waitingJobs.findIndex(
        (job) => job.data.caseId === parsedCaseId
      );

      if (queuePosition !== -1) {
        queuePosition += 1; // Convert zero-based index to position
      } else {
        queuePosition = 0; // Not found in queue
      }
    }

    return res.status(200).json({
      caseId: caseRecord.id.toString(),
      firstName,
      lastName,
      dateDeNaissance,
      sexe,
      beforeImageUrl,
      afterImageUrl,
      queuePosition,
    });
  } catch (err) {
    console.error("Error in getCaseStatus:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

exports.insertCaseImages = async (req, res) => {
  cpUpload(req, res, async (error) => {
    const { caseId, imageIndex } = req.body;
    const caseIdInt = parseInt(caseId);
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Obtain a mutex for the specific caseId
    let mutex = imagesMutexes.get(caseIdInt);
    if (!mutex) {
      mutex = new Mutex();
      imagesMutexes.set(caseIdInt, mutex);
    }

    const release = await mutex.acquire();

    try {
      const caseData = await prisma.cases.findUnique({
        where: { id: caseIdInt },
      });

      if (!caseData) {
        return res.status(404).json({ error: "Case not found" });
      }

      if (!req.files.image || req.files.image.length !== 1) {
        return res
          .status(400)
          .json({ error: "Exactly one image must be provided" });
      }

      const allowedMimeTypes = ["image/jpeg", "image/png"];
      const file = req.files.image[0];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res
          .status(400)
          .json({ error: "Invalid image type, only JPEG and PNG are allowed" });
      }

      const imageUrl = await uploadSingleFile(
        file,
        caseId,
        process.env.GOOGLE_STORAGE_BUCKET_CASE_IMAGES
      );

      const existingImages = await prisma.patient_images.findUnique({
        where: { case_id: caseIdInt },
      });

      if (existingImages) {
        const updateData = {};
        updateData[imageIndex] = imageUrl;
        await prisma.patient_images.update({
          where: { case_id: caseIdInt },
          data: updateData,
        });

        if (imageIndex === "image1") {
          const patient = await prisma.patients.findUnique({
            where: { id: caseData.patient_id },
          });
          await prisma.users.update({
            where: { id: patient.user_id },
            data: { profile_pic: imageUrl },
          });
        }

        res.status(200).json({
          message: "Image updated successfully!",
          imageUrl,
          status: true,
        });
      } else {
        const imageData = {
          [imageIndex]: imageUrl,
          case_id: caseIdInt,
          patient_id: caseData.patient_id,
          created_at: new Date(),
        };

        await prisma.patient_images.create({
          data: imageData,
        });

        if (imageIndex === "image1") {
          const patient = await prisma.patients.findUnique({
            where: { id: caseData.patient_id },
          });

          await prisma.users.update({
            where: { id: patient.user_id },
            data: { profile_pic: imageUrl },
          });
        }

        res.status(200).json({
          message: "Image uploaded and case created successfully!",
          imageUrl,
          status: true,
        });
      }
    } catch (err) {
      console.error("Failed in insertCaseImages:", err);
      res
        .status(500)
        .json({ error: err.message || "An unexpected error occurred" });
    } finally {
      release();
    }
  });
};

exports.getCaseImages = async (req, res) => {
  const { caseId } = req.query;
  const caseIdInt = BigInt(caseId);

  try {
    const caseImages = await prisma.patient_images.findUnique({
      where: { case_id: caseIdInt },
    });
    console.log(caseImages)
    if (!caseImages) {
      return res.status(404).json({ message: "Case with images not found" });
    }

    // Extract image URLs using the provided handler function
    let imageUrls = {};
    for (let i = 1; i <= 10; i++) {
      const imageKey = `image${i}`;
      const imageUrl = caseImages[imageKey]
        ? extractImagesHandle(caseImages[imageKey], patient_image_url)
        : null;
      imageUrls[imageKey] = imageUrl && imageUrl.length ? imageUrl[0] : null; // Since extractImagesHandle returns an array, we take the first element
    }

    return res.status(200).json(imageUrls);
  } catch (err) {
    console.error("Error fetching case images:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.insertCaseStls = async (req, res) => {
  cpUpload(req, res, async (error) => {
    const { caseId, stlIndex } = req.body;
    const caseIdInt = parseInt(caseId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let mutex = stlsMutexes.get(caseIdInt);
    if (!mutex) {
      mutex = new Mutex();
      stlsMutexes.set(caseIdInt, mutex);
    }

    const release = await mutex.acquire();

    try {
      const caseData = await prisma.cases.findUnique({
        where: { id: caseIdInt },
      });

      if (!caseData) {
        return res.status(404).json({ error: "Case not found" });
      }

      if (!req.files.stl || req.files.stl.length !== 1) {
        return res
          .status(400)
          .json({ error: "Exactly one STL file must be provided" });
      }

      const allowedMimeTypes = [
        "model/stl",
        "application/vnd.ms-pki.stl",
        "application/octet-stream",
      ];
      const file = req.files.stl[0];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({ error: "Invalid STL file type" });
      }

      const stlUrl = await uploadSingleFile(
        file,
        caseId,
        process.env.GOOGLE_STORAGE_BUCKET_CASE_STLS
      );

      const existingStls = await prisma.patient_stls.findUnique({
        where: { case_id: caseIdInt },
      });

      if (existingStls) {
        const updateData = {};
        updateData[stlIndex] = stlUrl;

        await prisma.patient_stls.update({
          where: { case_id: caseIdInt },
          data: updateData,
        });

        res
          .status(200)
          .json({ message: "STL file updated successfully!", stlUrl });
      } else {
        const stlData = {
          [stlIndex]: stlUrl,
          case_id: caseIdInt,
          patient_id: caseData.patient_id,
          created_at: new Date(),
        };

        await prisma.patient_stls.create({
          data: stlData,
        });

        res.status(200).json({
          message: "STL file uploaded and case updated successfully!",
          stlUrl,
        });
      }
    } catch (err) {
      console.error("Failed in insertCaseStls:", err);
      res
        .status(500)
        .json({ error: err.message || "An unexpected error occurred" });
    } finally {
      release();
    }
  });
};

exports.getStls = async (req, res) => {
  const { caseId } = req.query;
  const caseIdInt = parseInt(caseId);

  try {
    const caseStls = await prisma.patient_stls.findUnique({
      where: { case_id: caseIdInt },
    });

    if (!caseStls) {
      return res.status(404).json({ message: "Case with STLs not found" });
    }

    const stlResults = {};
    const baseUrl = "https://realsmilealigner.com";

    // Extract STLs and apply baseUrl if necessary, modifying to output as key-value pairs
    for (let i = 1; i <= 3; i++) {
      const stlKey = `custom_file_${i}`;
      if (caseStls[stlKey]) {
        const stlData = caseStls[stlKey];
        stlResults[`custom_file_${i}`] =
          stlData.startsWith("http://") || stlData.startsWith("https://")
            ? stlData
            : baseUrl + stlData;
      } else {
        stlResults[`custom_file_${i}`] = null; // Include null for missing STL files to maintain consistent keys
      }
    }

    return res.status(200).json(stlResults);
  } catch (err) {
    console.error("Error fetching case STLs:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.createOldInvoices = async (req, res) => {
  try {
    const { case_id, amount, pack_id, reduction } = req.body;

    if (!case_id) {
      throw new Error("case_id is required");
    }

    if (!pack_id) {
      throw new Error("pack_id is required");
    }

    // Fetch the pack price based on the pack_id
    const pack = await prisma.packs.findUnique({
      where: { id: BigInt(pack_id) },
      select: {
        id: true,
        name: true,
        tnd_price: true,
        drh_price: true,
        eur_price: true,
      },
    });

    if (!pack) {
      throw new Error("Pack not found");
    }

    // Determine the doctor's country and the appropriate price field
    const caseData = await prisma.cases.findUnique({
      where: { id: BigInt(case_id) },
      include: {
        doctor: {
          include: {
            user: true,
          },
        },
        status_histories: {
          orderBy: { id: "desc" },
          take: 1,
        },
      },
    });

    if (!caseData) {
      throw new Error("Case not found");
    }

    const doctorCountry = caseData?.doctor?.user?.country;
    let invoiceRefPrefix;
    let packPrice;

    switch (doctorCountry) {
      case "TN":
        invoiceRefPrefix = "TN-";
        packPrice = pack.tnd_price;
        break;
      case "MA":
        invoiceRefPrefix = "MA-";
        packPrice = pack.drh_price;
        break;
      default:
        invoiceRefPrefix = "EUR-";
        packPrice = pack.eur_price;
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(currentDate.getDate()).padStart(2, "0");

    const invoice_ref = `${invoiceRefPrefix}${caseData.id}-${year}${month}${day}`;

    if (amount <= 0) {
      throw new Error("Amount must be a positive number");
    }

    const redesignRequestedDate = new Date(caseData.created_at);
    const dueDate = new Date(redesignRequestedDate);
    dueDate.setDate(dueDate.getDate() + 30);

    const newDevis = await prisma.devis.create({
      data: {
        caseId: BigInt(case_id),
        price: packPrice.toString(),
        status: "accepted",
        due_date: dueDate,
        reduction: reduction || 0,
      },
    });

    await prisma.cases.update({
      where: { id: BigInt(case_id) },
      data: {
        pack_id,
      },
    });

    // Fetch the date of the status history with name 'in_construction'
    const inConstructionStatus = await prisma.status_histories.findFirst({
      where: {
        caseId: BigInt(case_id),
        name: "in_construction",
      },
      orderBy: {
        id: "desc", // Optional: Ensures you get the latest record if there are multiple
      },
    });

    if (!inConstructionStatus) {
      throw new Error(
        "Status 'in_construction' not found for the specified case"
      );
    }

    // Set the found date to invoice.case.created_at
    const caseCreatedAt = new Date(inConstructionStatus.created_at);

    const newInvoice = await prisma.invoices.create({
      data: {
        case_id: BigInt(case_id),
        amount: parseFloat(amount),
        payment_status: "unpaid",
        devis_id: newDevis.id,
        invoice_ref,
        due_date: dueDate,
        country_code: doctorCountry,
      },
    });

    const detailedInvoice = await prisma.invoices.findUnique({
      where: { id: newInvoice.id },
      include: {
        case: {
          include: {
            doctor: {
              include: {
                user: true,
              },
            },
            packs: true,
          },
        },
      },
    });

    // Assign case creation date before generating the PDF
    detailedInvoice.case.created_at = caseCreatedAt;

    const pdfUrl = await generateInvoicePdf(detailedInvoice);

    // Update the invoice with the PDF URL
    const updatedInvoice = await prisma.invoices.update({
      where: { id: newInvoice.id },
      data: { pdf_link: pdfUrl },
      include: {
        case: {
          include: {
            doctor: {
              include: {
                user: true,
              },
            },
            packs: true,
          },
        },
      },
    });

    // Helper function to convert BigInt values to string
    const convertBigIntToString = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (Array.isArray(obj)) return obj.map(convertBigIntToString);
      if (typeof obj === "object") {
        return Object.keys(obj).reduce((acc, key) => {
          acc[key] = convertBigIntToString(obj[key]);
          return acc;
        }, {});
      }
      return obj;
    };

    // Convert BigInt fields to strings
    const formattedInvoice = convertBigIntToString(updatedInvoice);

    console.log("Invoice created successfully:", formattedInvoice);
    res.status(200).json({
      message: "Invoice created successfully",
      invoice: formattedInvoice,
    });
  } catch (error) {
    console.error("Error creating invoice:", error);
    res.status(500).json({ error: "Error creating invoice" });
  }
};

exports.updateCaseNotes = async (req, res) => {
  const { caseId, noteInput } = req.body;
  try {
    const updatedCase = await prisma.cases.update({
      where: { id: parseInt(caseId) },
      data: { note: noteInput },
    });

    res.status(200).json({
      message: "Case notes updated successfully",
    });
  } catch (err) {
    console.error("Error updating case notes:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.changeStatusToExpidie = async (req, res) => {
  const { caseId, noteInput } = req.body;

  console.log("caseId", caseId);
  try {
    // Check the last status history
    const lastHistory = await prisma.status_histories.findFirst({
      where: {
        caseId: parseInt(caseId),
      },
      select: {
        name: true,
      },
      orderBy: {
        id: "desc",
      },
    });

    console.log("lastHistory", lastHistory);

    // If the last history status is "in_construction", proceed with the update
    if (lastHistory && lastHistory.name === statusDbEnum.in_construction) {
      // Fetch the case data and patient details
      const caseData = await prisma.cases.update({
        where: { id: parseInt(caseId) },
        data: {
          shipping_link: noteInput,
        },
        include: {
          patient: true,
          doctor: {
            include: {
              user: true,
            },
          },
        },
      });

      await prisma.status_histories.create({
        data: {
          case: {
            connect: {
              id: BigInt(caseId), // Ensure this is the correct identifier field for your cases table
            },
          },
          name: statusDbEnum.redesign_requested,
          created_at: new Date(),
        },
      });

      const templatePath = "templates/email/expedie.html"; // Provide the path to your HTML template
      const templateData = {
        livraisonUrl: noteInput,
        patientName: `${caseData.patient.first_name} ${caseData.patient.last_name}`, // Add patient name
      };

      await queueEmail({
        emails: [caseData.doctor.user.email],
        subject: `Cas Expédié (cas #${caseData.id.toString()})`,
        templatePath: templatePath,
        templateData: templateData,
      });

      const customerNotification = {
        xa1: caseData.doctor.user.id.toString(),
        xa2: `Cas Expédié (cas #${caseData.id.toString()})`,
        xa3: `Nous vous informons que les aligneurs de votre patient ${caseData.patient.first_name} ${caseData.patient.last_name} ont été expédiés. Vous pouvez suivre l'état de la livraison sur la plateforme Realsmile. Merci,L'équipe Realsmile`,
        xa5: "",
        xa9: caseData.doctor.user.email,
        xd1: admin.firestore.Timestamp.now().toMillis(),
        xf4: false,
      };

      // Reference to the customer's customernotifications document
      const customerNotificationsDocRef = doc(
        db,
        "customers",
        caseData.doctor.user.id.toString(),
        "customernotifications",
        "customernotifications"
      );

      // Check if the customer notifications document exists
      const docSnap = await getDoc(customerNotificationsDocRef);
      if (docSnap.exists()) {
        // Append the new notification to the list
        await updateDoc(customerNotificationsDocRef, {
          list: arrayUnion(customerNotification),
          xa2: `Cas Expédié (cas #${caseData.id.toString()})`,
          xa3: `Nous vous informons que les aligneurs de votre patient ${caseData.patient.first_name} ${caseData.patient.last_name} ont été expédiés. Vous pouvez suivre l'état de la livraison sur la plateforme Realsmile. Merci,L'équipe Realsmile`,
          xa4: "PUSH",
          xd1: admin.firestore.Timestamp.now().toMillis(),
        });
      } else {
        console.error("Customer notifications document does not exist.");
      }

      res.status(200).json({
        message: "Case status updated to expedited successfully",
      });
    } else {
      // If the last status is not "in_construction", return an error response
      res.status(400).json({
        message:
          "Cannot update case status. Last status is not 'in_construction'.",
      });
    }
  } catch (err) {
    console.error("Error updating case status to expedited:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.changeStatusToRejected = async (req, res) => {
  const { caseId } = req.body;

  console.log("caseId", caseId);
  try {
    await prisma.status_histories.create({
      data: {
        case: {
          connect: {
            id: BigInt(caseId), // Ensure this is the correct identifier field for your cases table
          },
        },
        name: statusDbEnum.rejected,
        created_at: new Date(),
      },
    });

    // const templatePath = 'templates/email/expedie.html'; // Provide the path to your HTML template
    // const templateData = {
    //     livraisonUrl: noteInput,
    //     patientName: `${caseData.patient.first_name} ${caseData.patient.last_name}`, // Add patient name
    // };
    //
    // await sendEmail({
    //     email: caseData.doctor.user.email,
    //     subject: `Cas Expédié (cas #${caseData.id.toString()})`,
    //     templatePath: templatePath,
    //     templateData: templateData,
    // });
    //
    // const customerNotification = {
    //     xa1: caseData.doctor.user.id.toString(),
    //     xa2: `Cas Expédié (cas #${caseData.id.toString()})`,
    //     xa3: `Nous vous informons que les aligneurs de votre patient ${caseData.patient.first_name} ${caseData.patient.last_name} ont été expédiés. Vous pouvez suivre l'état de la livraison sur la plateforme Realsmile. Merci,L'équipe Realsmile`,
    //     xa5: "",
    //     xa9: caseData.doctor.user.email,
    //     xd1: admin.firestore.Timestamp.now().toMillis(),
    //     xf4: false,
    // };
    //
    // // Reference to the customer's customernotifications document
    // const customerNotificationsDocRef = doc(db, "customers", caseData.doctor.user.id.toString(), "customernotifications", "customernotifications");
    //
    // // Check if the customer notifications document exists
    // const docSnap = await getDoc(customerNotificationsDocRef);
    // if (docSnap.exists()) {
    //     // Append the new notification to the list
    //     await updateDoc(customerNotificationsDocRef, {
    //         list: arrayUnion(customerNotification),
    //         xa2: `Cas Expédié (cas #${caseData.id.toString()})`,
    //         xa3: `Nous vous informons que les aligneurs de votre patient ${caseData.patient.first_name} ${caseData.patient.last_name} ont été expédiés. Vous pouvez suivre l'état de la livraison sur la plateforme Realsmile. Merci,L'équipe Realsmile`,
    //         xa4: "PUSH",
    //         xd1: admin.firestore.Timestamp.now().toMillis()
    //     });
    // } else {
    //     console.error("Customer notifications document does not exist.");
    // }

    res.status(200).json({
      message: "Case status updated to rejected successfully",
    });
  } catch (err) {
    console.error("Error updating case status to expedited:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.changeStatusToComplete = async (req, res) => {
  const { caseId } = req.body;

  console.log("caseId", caseId);
  try {
    await prisma.status_histories.create({
      data: {
        case: {
          connect: {
            id: BigInt(caseId), // Ensure this is the correct identifier field for your cases table
          },
        },
        name: statusDbEnum.complete,
        created_at: new Date(),
      },
    });

    // const templatePath = 'templates/email/expedie.html'; // Provide the path to your HTML template
    // const templateData = {
    //     livraisonUrl: noteInput,
    //     patientName: `${caseData.patient.first_name} ${caseData.patient.last_name}`, // Add patient name
    // };
    //
    // await sendEmail({
    //     email: caseData.doctor.user.email,
    //     subject: `Cas Expédié (cas #${caseData.id.toString()})`,
    //     templatePath: templatePath,
    //     templateData: templateData,
    // });
    //
    // const customerNotification = {
    //     xa1: caseData.doctor.user.id.toString(),
    //     xa2: `Cas Expédié (cas #${caseData.id.toString()})`,
    //     xa3: `Nous vous informons que les aligneurs de votre patient ${caseData.patient.first_name} ${caseData.patient.last_name} ont été expédiés. Vous pouvez suivre l'état de la livraison sur la plateforme Realsmile. Merci,L'équipe Realsmile`,
    //     xa5: "",
    //     xa9: caseData.doctor.user.email,
    //     xd1: admin.firestore.Timestamp.now().toMillis(),
    //     xf4: false,
    // };
    //
    // // Reference to the customer's customernotifications document
    // const customerNotificationsDocRef = doc(db, "customers", caseData.doctor.user.id.toString(), "customernotifications", "customernotifications");
    //
    // // Check if the customer notifications document exists
    // const docSnap = await getDoc(customerNotificationsDocRef);
    // if (docSnap.exists()) {
    //     // Append the new notification to the list
    //     await updateDoc(customerNotificationsDocRef, {
    //         list: arrayUnion(customerNotification),
    //         xa2: `Cas Expédié (cas #${caseData.id.toString()})`,
    //         xa3: `Nous vous informons que les aligneurs de votre patient ${caseData.patient.first_name} ${caseData.patient.last_name} ont été expédiés. Vous pouvez suivre l'état de la livraison sur la plateforme Realsmile. Merci,L'équipe Realsmile`,
    //         xa4: "PUSH",
    //         xd1: admin.firestore.Timestamp.now().toMillis()
    //     });
    // } else {
    //     console.error("Customer notifications document does not exist.");
    // }

    res.status(200).json({
      message: "Case status updated to completed successfully",
    });
  } catch (err) {
    console.error("Error updating case status to expedited:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateCaseToInTreatment = async (req, res) => {
  const { caseId, treatmentDate } = req.body;
  console.log("caseId", caseId);
  console.log("body :", req.body);

  try {
    await prisma.status_histories.create({
      data: {
        case: {
          connect: {
            id: BigInt(caseId), // Ensure this is the correct identifier field for your cases table
          },
        },
        name: statusDbEnum.in_treatment,

        // created_at: new Date(),
        created_at: treatmentDate,
      },
    });
    res.status(200).json({
      message: "Case status updated to in treatment successfully",
    });
  } catch (err) {
    console.error("Error updating case status to in treatment:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.createCase = async (req, res) => {
  const { user: reqUser, body } = req;
  const { caseId, form_data } = body;
  const { personalizedPlan, archSelection, generalInstructions } = form_data;
  const dateNow = new Date();

  try {
    // Fetch the current case data and patient details
    const currentCase = await prisma.cases.findUnique({
      where: { id: parseInt(caseId) },
      select: {
        id: true,
        case_data: true,
        patient: {
          select: {
            first_name: true,
            last_name: true,
          },
        },
        doctor: {
          select: {
            user: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    console.log("currentCase : ", currentCase);

    if (!currentCase) {
      throw new Error("Case not found");
    }

    const patientName = `${currentCase.patient.first_name} ${currentCase.patient.last_name}`;

    let updatedCaseData = {
      ...currentCase.case_data,
    };

    let data = {
      personalized_plan: personalizedPlan,
      arch_selection: archSelection, // Append new/updated fields
      general_instructions: generalInstructions,
      case_data: updatedCaseData,
      updated_at: dateNow,
    };

    const caseData = await prisma.cases.update({
      where: { id: parseInt(caseId) },
      data,
    });

    const statusHistory = await prisma.status_histories.create({
      data: {
        caseId: parseInt(caseId),
        name: statusDbEnum.pending,
        created_at: dateNow,
      },
    });

    const templatePath = "templates/email/smileset.html";
    const templateData = {
      caseId: parseInt(caseId).toString(),
      patientName: patientName,
    };

    await queueEmail({
      emails: [
        currentCase.doctor.user.email,
        "Drkessemtini@realsmile.fr",
        "clearcareortho2@gmail.com",
        "Azeem@clearcareortho.uk",
        "Akif@clearcareortho.uk",
      ],
      subject: `SmileSet en cours de conception (cas #${caseId.toString()})`,
      templatePath: templatePath,
      templateData: templateData,
    });

    const customerNotification = {
      xa1: currentCase.doctor.user.id.toString(),
      xa2: `SmileSet en cours de conception (cas #${caseId.toString()})`,
      xa3: `Nous vous informons que le SmileSet pour le cas N°${currentCase.id} de votre patient (${patientName}) est actuellement en cours Merci, L'équipe Realsmile.`,
      xa5: "",
      xa9: currentCase.doctor.user.email,
      xd1: admin.firestore.Timestamp.now().toMillis(),
      xf4: false,
    };

    const agentNotification = {
      xa1: currentCase.doctor.user.id.toString(),
      xa2: `SmileSet en cours de conception (cas #${caseId.toString()}) du docteur ${
        currentCase.doctor.user.first_name
      } ${currentCase.doctor.user.last_name}`,
      xa3: `Le cas du docteur ${currentCase.doctor.user.first_name} ${currentCase.doctor.user.last_name} pour le patient ${currentCase.patient.first_name} ${currentCase.patient.last_name} a été mis à jour et est maintenant en cours.`,
      xa5: "",
      xa9: currentCase.doctor.user.email,
      xd1: admin.firestore.Timestamp.now().toMillis(),
      xf4: false,
    };

    // Reference to the customer's customernotifications document
    const customerNotificationsDocRef = doc(
      db,
      "customers",
      currentCase.doctor.user.id.toString(),
      "customernotifications",
      "customernotifications"
    );
    // Reference to the agent's agentnotifications document
    const agentNotificationsDocRef = doc(db, "userapp", "agentnotifications");

    // Check if the customer notifications document exists
    const customerDocSnap = await getDoc(customerNotificationsDocRef);
    if (customerDocSnap.exists()) {
      // Append the new notification to the list
      await updateDoc(customerNotificationsDocRef, {
        list: arrayUnion(customerNotification),
        xa2: `SmileSet en cours de conception (cas #${caseId.toString()})`,
        xa3: `Nous vous informons que le SmileSet pour le cas N°${currentCase.id} de votre patient (${patientName}) est actuellement en cours Merci, L'équipe Realsmile.`,
        xa4: "PUSH",
        xd1: admin.firestore.Timestamp.now().toMillis(),
      });
    } else {
      console.error("Customer notifications document does not exist.");
    }

    // Check if the agent notifications document exists
    const agentDocSnap = await getDoc(agentNotificationsDocRef);
    if (agentDocSnap.exists()) {
      // Append the new notification to the list
      await updateDoc(agentNotificationsDocRef, {
        list: arrayUnion(agentNotification),
        xa2: `SmileSet en cours de conception (cas #${caseId.toString()}) du docteur ${
          currentCase.doctor.user.first_name
        } ${currentCase.doctor.user.last_name}`,
        xa3: `Le cas du docteur ${currentCase.doctor.user.first_name} ${currentCase.doctor.user.last_name} pour le patient ${currentCase.patient.first_name} ${currentCase.patient.last_name} a été mis à jour et est maintenant en cours.`,
        xa4: "PUSH",
        xd1: admin.firestore.Timestamp.now().toMillis(),
      });
    } else {
      console.error("Agent notifications document does not exist.");
    }

    res.status(201).json({
      message: "Case updated and status history added successfully",
      case: caseData.id.toString(),
      statusHistoryId: statusHistory.id.toString(),
    });
  } catch (err) {
    console.error("Error when updating the Case:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.step4 = async (req, res) => {
  let { user: reqUser, body } = req;
  let { caseId, personalizedPlan } = body;

  const dateNow = new Date();

  try {
    // Use Prisma transaction to handle multiple operations atomically
    await prisma.$transaction(async (prisma) => {
      let data = {
        updated_at: dateNow,
        personalized_plan: req.body.personalizedPlan,
        arch_selection: req.body.archSelection,
        general_instructions: req.body.generalInstructions,
      };

      // Update the existing case
      const caseData = await prisma.cases.update({
        where: { id: parseInt(caseId) },
        data,
      });

      /* sendEmail */
      // Successful update and creation of status history
      res.status(201).json({
        message: "Case updated successfully",
        case: caseData.id.toString(),
        data: {
          personalizedPlan: data.personalized_plan,
        },
      });
    });
  } catch (err) {
    console.error("Error when updating the Case:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.step56 = async (req, res) => {
  const { user: reqUser, body } = req;
  const { caseId, form_data } = body;

  if (!caseId || isNaN(parseInt(caseId))) {
    return res.status(400).json({ error: "Invalid case ID" });
  }

  const dateNow = new Date();

  try {
    await prisma.$transaction(async (prisma) => {
      // Retrieve the current case data
      const currentCase = await prisma.cases.findUnique({
        where: { id: parseInt(caseId) },
        select: { case_data: true },
      });

      if (!currentCase) {
        return res.status(404).json({ error: "Case not found" });
      }

      // Overwrite existing fields with new form data
      const updatedCaseData = { ...currentCase.case_data, ...form_data };

      const data = {
        updated_at: dateNow,
        case_data: updatedCaseData,
      };

      // Update the existing case
      const caseData = await prisma.cases.update({
        where: { id: parseInt(caseId) },
        data,
      });

      res.status(201).json({
        message: "Case updated successfully",
        case: caseData.id.toString(),
        updatedCaseData: caseData.case_data,
      });
    });
  } catch (err) {
    console.error("Error when updating the Case:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.step7 = async (req, res) => {
  const { user: reqUser, body } = req;
  const { caseId, form_data } = body;

  const dateNow = new Date();

  try {
    // First, retrieve the current case data
    const currentCase = await prisma.cases.findUnique({
      where: { id: parseInt(caseId) },
      select: {
        case_data: true,
        patient: {
          select: {
            first_name: true,
            last_name: true,
            date_of_birth: true,
            gender: true,
          },
        },
        doctor: {
          select: {
            user: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    if (!currentCase) {
      throw new Error("Case not found");
    }

    // Overwrite existing fields with new form data
    const updatedCaseData = { ...currentCase.case_data, ...form_data };

    const data = {
      updated_at: dateNow,
      case_data: updatedCaseData,
    };

    // Update the existing case
    const updatedCase = await prisma.cases.update({
      where: { id: parseInt(caseId) },
      data,
    });

    await prisma.status_histories.create({
      data: {
        case: {
          connect: {
            id: BigInt(caseId),
          },
        },
        name: statusDbEnum.pending,
        created_at: new Date(),
      },
    });

    const caseData = {
      caseData: updatedCase,
      patient: currentCase.patient,
      doctorEmail: currentCase.doctor.user.email,
      doctorFirstName: currentCase.doctor.user.first_name,
      doctorLastName: currentCase.doctor.user.last_name,
      doctorId: currentCase.doctor.user.id,
    };

    const pdfData = {
      patient: caseData.patient,
      caseData: caseData.caseData.case_data,
    };

    // Read the HTML template
    const htmlTemplate = fs.readFileSync("templates/case.html", "utf8");

    // Generate the PDF outside of the transaction
    const pdfLink = await generatePdfForCase(
      pdfData,
      caseData.caseData.id,
      htmlTemplate
    );

    const templatePath = "templates/email/smileset.html"; // Provide the path to your HTML template
    const templateData = {
      caseId: caseData.caseData.id.toString(),
      patientName: `${caseData.patient.first_name} ${caseData.patient.last_name}`, // Add patient name
    };

    await queueEmail({
      emails: [
        caseData.doctorEmail,
        "Drkessemtini@realsmile.fr",
        "clearcareortho2@gmail.com",
        "Azeem@clearcareortho.uk",
        "Akif@clearcareortho.uk",
      ],
      subject: `SmileSet en cours de conception (cas #${caseData.caseData.id.toString()})`,
      templatePath: templatePath,
      templateData: templateData,
    });

    const customerNotification = {
      xa1: caseData.doctorId.toString(),
      xa2: "SmileSet en cours de conception",
      xa3: `Votre cas a été mis à jour avec succès et est maintenant en cours pour le patient ${caseData.patient.first_name} ${caseData.patient.last_name}.`,
      xa5: "",
      xa9: caseData.doctorEmail,
      xd1: admin.firestore.Timestamp.now().toMillis(),
      xf4: false,
    };

    const agentNotification = {
      xa1: caseData.doctorId.toString(),
      xa2: `SmileSet en cours de conception (cas #${caseId.toString()}) du docteur ${
        caseData.doctorFirstName
      } ${caseData.doctorLastName}`,
      xa3: `Le cas du docteur ${caseData.doctorFirstName} ${caseData.doctorLastName} pour le patient ${caseData.patient.first_name} ${caseData.patient.last_name} a été mis à jour et est maintenant en cours.`,
      xa5: "",
      xa9: caseData.doctorEmail,
      xd1: admin.firestore.Timestamp.now().toMillis(),
      xf4: false,
    };

    // Reference to the customer's customernotifications document
    const customerNotificationsDocRef = doc(
      db,
      "customers",
      caseData.doctorId.toString(),
      "customernotifications",
      "customernotifications"
    );
    // Reference to the agent's agentnotifications document
    const agentNotificationsDocRef = doc(db, "userapp", "agentnotifications");

    // Check if the customer notifications document exists
    const customerDocSnap = await getDoc(customerNotificationsDocRef);
    if (customerDocSnap.exists()) {
      // Append the new notification to the list
      await updateDoc(customerNotificationsDocRef, {
        list: arrayUnion(customerNotification),
        xa2: "SmileSet en cours de conception",
        xa3: `Votre cas a été mis à jour avec succès et est maintenant en cours pour le patient ${caseData.patient.first_name} ${caseData.patient.last_name}.`,
        xa4: "PUSH",
        xd1: admin.firestore.Timestamp.now().toMillis(),
      });
    } else {
      console.error("Customer notifications document does not exist.");
    }

    // Check if the agent notifications document exists
    const agentDocSnap = await getDoc(agentNotificationsDocRef);
    if (agentDocSnap.exists()) {
      // Append the new notification to the list
      await updateDoc(agentNotificationsDocRef, {
        list: arrayUnion(agentNotification),
        xa2: `SmileSet en cours de conception (cas #${caseId.toString()}) du docteur ${
          caseData.doctorFirstName
        } ${caseData.doctorLastName}`,
        xa3: `Le cas du docteur ${caseData.doctorFirstName} ${caseData.doctorLastName} pour le patient ${caseData.patient.first_name} ${caseData.patient.last_name} a été mis à jour et est maintenant en cours.`,
        xa4: "PUSH",
        xd1: admin.firestore.Timestamp.now().toMillis(),
      });
    } else {
      console.error("Agent notifications document does not exist.");
    }

    res.status(200).json({
      message: "Case updated successfully",
      case: caseData.caseData.id.toString(),
      updatedCaseData: caseData.caseData.case_data,
      pdfLink: pdfLink,
    });
  } catch (err) {
    console.error("Error when updating the Case:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.createCaseInConstructionFile = async (req, res) => {
  const { caseId, zipUrl } = req.body;
  console.log("body", req.body);

  try {
    await prisma.construction_files.create({
      data: {
        file_path: zipUrl,
        created_at: new Date(),
        case: {
          connect: {
            id: BigInt(caseId),
          },
        },
      },
    });

    res.status(200).json({
      message: "zip file added successfully",
    });
  } catch (err) {
    console.error("Error creating in construction file:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.generatePdf = async (req, res) => {
  const caseId = req.params.caseId;

  try {
    let caseData = await prisma.$transaction(async (prisma) => {
      // Retrieve the current case data
      const currentCase = await prisma.cases.findUnique({
        where: { id: BigInt(caseId) },
        select: {
          id: true,
          case_data: true,
          patient: {
            select: {
              first_name: true,
              last_name: true,
              date_of_birth: true,
              gender: true,
            },
          },
        },
      });

      if (!currentCase) {
        throw new Error("Case not found");
      }

      // If the PDF link already exists, return it
      if (currentCase.pdf_link && currentCase.pdf_link !== "") {
        return {
          pdfLink: currentCase.pdf_link,
          patient: currentCase.patient,
        };
      }

      return {
        caseData: currentCase,
        patient: currentCase.patient,
      };
    });

    if (caseData.pdfLink) {
      return res
        .status(200)
        .json({ message: "PDF already generated.", link: caseData.pdfLink });
    }

    const pdfData = {
      patient: caseData.patient,
      caseData: caseData.caseData.case_data,
    };

    // Read the HTML template
    const htmlTemplate = fs.readFileSync("templates/case.html", "utf8");

    // Generate the PDF outside of the transaction
    const pdfLink = await generatePdfForCase(
      pdfData,
      caseData.caseData.id,
      htmlTemplate
    );

    // Update the case with the new PDF link
    await prisma.cases.update({
      where: { id: BigInt(caseId) },
      data: {
        pdf_link: pdfLink,
      },
    });

    res.status(200).json({
      message: "PDF generated successfully",
      link: pdfLink,
    });
  } catch (err) {
    console.error("Error when generating the PDF:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteCase = async (req, res) => {
  const { id } = req.params;
  const caseIdInt = BigInt(id);

  try {
    const caseData = await prisma.cases.findUnique({
      where: { id: caseIdInt },
      include: {
        status_histories: true,
      },
    });

    if (!caseData) {
      return res.status(404).json({ message: "Case not found" });
    }

    if (req.user.role === "doctor") {
      const lastStatus =
        caseData.status_histories[caseData.status_histories.length - 1];
      if (lastStatus.name !== statusDbEnum.incomplete) {
        return res.status(400).json({
          message: "Cannot delete case with status other than 'incomplete'",
        });
      }
    }

    await prisma.cases.delete({
      where: { id: caseIdInt },
    });

    res.status(200).json({ message: "Case deleted successfully" });
  } catch (err) {
    console.error("Error deleting case:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.commandCase = async (req, res) => {
  const { caseId } = req.body;
  const caseIdInt = BigInt(caseId);

  try {
    // Fetch the original case data along with related data
    const caseData = await prisma.cases.findUnique({
      where: { id: caseIdInt },
      include: {
        labo_links: true, // Fetch all labo_links
        patient_images: true,
        patient_stls: true,
        status_histories: true,
        patient: true,
      },
    });

    if (!caseData) {
      throw new Error("Case not found");
    }

    // Mark the old case as complete
    await prisma.status_histories.create({
      data: {
        caseId: caseData.id,
        name: statusDbEnum.complete,
        created_at: new Date(),
      },
    });

    // Prepare new case data with the updated status
    const newCaseData = {
      patient_id: caseData.patient_id,
      doctor_id: caseData.doctor_id,
      reason_hold: caseData.reason_hold,
      in_transit: caseData.in_transit,
      fav: caseData.fav,
      approved: caseData.approved,
      is_archive: caseData.is_archive,
      discount_amount: caseData.discount_amount,
      is_deleted: caseData.is_deleted,
      case_data: caseData.case_data,
      personalized_plan: caseData.personalized_plan,
      note: caseData.note,
      pack_id: caseData.pack_id,
      shipping_link: caseData.shipping_link,
      pdf_link: caseData.pdf_link,
      arch_selection: caseData.arch_selection,
      general_instructions: caseData.general_instructions,
      smile_summary: caseData.smile_summary,
      movement_chart_summary: caseData.movement_chart_summary,
      case_type: caseTypeDbEnum.command,
      created_at: new Date(), // Set the creation date to now
    };

    // Create the new case
    const newCase = await prisma.cases.create({
      data: newCaseData,
    });

    // Clone related data with the new case ID
    if (caseData.labo_links.length > 0) {
      const laboLinksData = caseData.labo_links.map((laboLink) => ({
        case_id: newCase.id,
        iiwgl_link: laboLink.iiwgl_link,
        admin_validation_status: laboLink.admin_validation_status,
        doctor_validation_status: laboLink.doctor_validation_status,
        validated_by_admin: laboLink.validated_by_admin,
        validated_by_doctor: laboLink.validated_by_doctor,
        admin_note: laboLink.admin_note,
        doctor_note: laboLink.doctor_note,
        pdf_file: laboLink.pdf_file,
        created_at: new Date(),
      }));

      await prisma.labo_links.createMany({ data: laboLinksData });
    }

    if (caseData.patient_images) {
      const patientImagesData = {
        patient_id: caseData.patient_images.patient_id,
        case_id: newCase.id,
        image1: caseData.patient_images.image1,
        image2: caseData.patient_images.image2,
        image3: caseData.patient_images.image3,
        image4: caseData.patient_images.image4,
        image5: caseData.patient_images.image5,
        image6: caseData.patient_images.image6,
        image7: caseData.patient_images.image7,
        image8: caseData.patient_images.image8,
        image9: caseData.patient_images.image9,
        image10: caseData.patient_images.image10,
        created_at: new Date(),
      };

      await prisma.patient_images.create({ data: patientImagesData });
    }

    if (caseData.patient_stls) {
      const patientStlsData = {
        patient_id: caseData.patient_stls.patient_id,
        case_id: newCase.id,
        aligner_number: caseData.patient_stls.aligner_number,
        design_instruction: caseData.patient_stls.design_instruction,
        custom_file_1: caseData.patient_stls.custom_file_1,
        custom_file_2: caseData.patient_stls.custom_file_2,
        custom_file_3: caseData.patient_stls.custom_file_3,
        created_at: new Date(),
      };

      await prisma.patient_stls.create({ data: patientStlsData });
    }

    await prisma.status_histories.create({
      data: {
        caseId: newCase.id,
        name: statusDbEnum.in_construction,
        created_at: new Date(),
      },
    });

    // Determine the parent ID for the association
    let parentCaseId = caseData.id;

    if (caseData.case_type !== caseTypeDbEnum.normal) {
      const parentAssociation = await prisma.caseAssociation.findFirst({
        where: { linked_case_id: caseData.id },
      });

      if (parentAssociation) {
        parentCaseId = parentAssociation.case_id;
      }
    }

    // Count the existing associations for the parent case
    const existingAssociationsCount = await prisma.caseAssociation.count({
      where: { case_id: parentCaseId },
    });

    // Create the association between the parent case and the new case with the order
    await prisma.caseAssociation.create({
      data: {
        case_id: parentCaseId,
        linked_case_id: newCase.id,
        order: existingAssociationsCount + 1,
      },
    });

    // Fetch doctor data for notifications
    const doctorData = await prisma.doctors.findUnique({
      where: { id: caseData.doctor_id },
      include: { user: true },
    });

    if (!doctorData || !doctorData.user) {
      throw new Error("Doctor not found or user related to doctor not found");
    }

    const templatePath = "templates/email/en-fabrication.html";
    const templateData = {
      case_id: parseInt(caseData.id).toString(),
      doctor_name: doctorData.user.first_name + " " + doctorData.user.last_name,
      patient_name:
        caseData.patient.first_name + " " + caseData.patient.last_name,
    };

    await queueEmail({
      emails: [
        doctorData.user.email,
        "Drkessemtini@realsmile.fr",
        "Realsmile984@gmail.com",
      ],
      subject: `Cas en fabrication (cas #${caseData.id.toString()})`,
      templatePath: templatePath,
      templateData: templateData,
    });

    res.status(200).json({
      message: "Case commanded successfully",
      newCaseId: newCase.id.toString(),
    });
  } catch (error) {
    console.error("Error commanding case:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.renumereCase = async (req, res) => {
  const { caseId } = req.body;

  if (!caseId || isNaN(caseId)) {
    return res.status(400).json({ message: "Invalid case ID provided." });
  }

  const caseIdInt = BigInt(caseId);

  try {
    await prisma.$transaction(async (prisma) => {
      // Fetch the original case data without images, STLs, and links
      const caseData = await prisma.cases.findUnique({
        where: { id: caseIdInt },
      });

      if (!caseData) {
        throw new Error("Case not found");
      }

      // Check the last status history
      const lastStatusHistory = await prisma.status_histories.findFirst({
        where: { caseId: caseData.id },
        orderBy: { created_at: "desc" }, // Get the most recent status history
      });

      if (
        lastStatusHistory &&
        lastStatusHistory.name !== statusDbEnum.complete
      ) {
        // Mark the old case as complete only if the last status is not 'complete'
        await prisma.status_histories.create({
          data: {
            caseId: caseData.id,
            name: statusDbEnum.complete,
            created_at: new Date(),
          },
        });
      }

      // Prepare new case data with the updated status and case type set to "R"
      const newCaseData = {
        patient_id: caseData.patient_id,
        doctor_id: caseData.doctor_id,
        reason_hold: caseData.reason_hold,
        in_transit: caseData.in_transit,
        fav: caseData.fav,
        approved: caseData.approved,
        is_archive: caseData.is_archive,
        discount_amount: caseData.discount_amount,
        is_deleted: caseData.is_deleted,
        case_data: caseData.case_data,
        personalized_plan: caseData.personalized_plan,
        pack_id: 11,
        shipping_link: caseData.shipping_link,
        pdf_link: caseData.pdf_link,
        arch_selection: caseData.arch_selection,
        general_instructions: caseData.general_instructions,
        smile_summary: caseData.smile_summary,
        movement_chart_summary: caseData.movement_chart_summary,
        case_type: "R", // Set the case type to "R"
        created_at: new Date(), // Set the creation date to now
      };

      // Create the new case
      const newCase = await prisma.cases.create({
        data: newCaseData,
      });

      console.log("New case created:", newCase);

      const newCaseStatusHistory = await prisma.status_histories.create({
        data: {
          caseId: newCase.id,
          name: statusDbEnum.pending,
          created_at: new Date(),
        },
      });

      console.log("newCaseStatusHistory:", newCaseStatusHistory);

      // Determine the parent ID for the association
      let parentCaseId = caseData.id;

      // If the case is not of normal type, find the root case
      if (caseData.case_type !== caseTypeDbEnum.normal) {
        const parentAssociation = await prisma.caseAssociation.findFirst({
          where: { linked_case_id: caseData.id },
        });

        if (parentAssociation) {
          parentCaseId = parentAssociation.case_id;
        }
      }

      // Count the existing associations for the parent case
      const existingAssociationsCount = await prisma.caseAssociation.count({
        where: { case_id: parentCaseId },
      });

      // Create the association between the parent case and the new case with the order
      await prisma.caseAssociation.create({
        data: {
          case_id: parentCaseId,
          linked_case_id: newCase.id,
          order: existingAssociationsCount + 1,
        },
      });

      res.status(200).json({
        message: "Case renumere successfully",
        newCaseId: newCase.id.toString(),
      });
    });
  } catch (error) {
    console.error("Error renumere case:", error);

    if (error.message === "Case not found") {
      return res.status(404).json({ message: "Case not found" });
    }

    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.renumereCaseInstructions = async (req, res) => {
  const { caseId, instructions } = req.body;

  //update the case's instructions_renumerisation field
  try {
    await prisma.cases.update({
      where: { id: BigInt(caseId) },
      data: { instructions_renumerisation: instructions },
    });
    res
      .status(200)
      .json({ message: "Instructions renumeration updated successfully" });
  } catch (error) {
    console.error("Error updating instructions renumeration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getSubCases = async (req, res) => {
  console.log("req.params", req.params);
  const { caseId } = req.params;
  console.log("caseId", caseId);
  const user = req.user;

  try {
    // Fetch the case data to check the doctor.user.id
    let caseData = await prisma.cases.findUnique({
      where: { id: BigInt(caseId) },
      include: {
        doctor: {
          include: {
            user: true,
          },
        },
        related_cases: true,
        linked_cases: true,
        patient: {
          include: {
            user: true,
          },
        },
        status_histories: true,
        devis: true,
      },
    });

    if (!caseData) {
      return res.status(404).json({ message: "Case not found" });
    }

    // Verify if the case belongs to the connected doctor if the user is a doctor
    if (user.role !== "admin" && caseData.doctor.user.id !== BigInt(user.id)) {
      return res.status(500).json({ message: "Unauthorized access" });
    }

    // If the case is not a root case, find the root case
    if (caseData.case_type !== "N") {
      const rootAssociation = await prisma.caseAssociation.findFirst({
        where: { linked_case_id: BigInt(caseId) },
        include: {
          cases: {
            include: {
              doctor: {
                include: {
                  user: true,
                },
              },
              related_cases: true,
              linked_cases: true,
              patient: {
                include: {
                  user: true,
                },
              },
              status_histories: true,
              devis: true,
            },
          },
        },
      });

      if (!rootAssociation) {
        return res.status(404).json({ message: "Root case not found" });
      }

      caseData = rootAssociation.cases;
    }

    // Fetch all linked cases for the root case
    const subCases = await prisma.caseAssociation.findMany({
      where: { case_id: BigInt(caseData.id) },
      include: {
        linked_cases: {
          include: {
            doctor: {
              include: {
                user: true,
              },
            },
            patient: {
              include: {
                user: true,
              },
            },
            status_histories: true,
            devis: true,
          },
        },
      },
    });

    const cases = subCases.map((subCase) => ({
      id: subCase.linked_cases.id.toString(),
      status:
        statusMap[subCase.linked_cases.status_histories[0]?.name] ||
        "Status Unknown",
      created_at: new Date(subCase.linked_cases.created_at).toISOString(),
      patient: {
        name: `${subCase.linked_cases.patient.user.first_name} ${subCase.linked_cases.patient.user.last_name}`,
        avatar:
          extractSingleImage(
            subCase.linked_cases.patient?.user?.profile_pic,
            patient_image_url
          ) ||
          "https://storage.googleapis.com/realsmilefiles/staticFolder/patientCompress.png",
        phone: subCase.linked_cases.patient.user.phone || "Non spécifié",
      },
      doctor: {
        user: {
          id:
            user.role === "admin"
              ? subCase.linked_cases.doctor.user.id.toString()
              : undefined,
        },
        name: `${subCase.linked_cases.doctor.user.first_name} ${subCase.linked_cases.doctor.user.last_name}`,
        avatar:
          extractSingleImage(
            subCase.linked_cases.doctor?.user?.profile_pic,
            doctor_image_url
          ) ||
          "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png",
        phone: subCase.linked_cases.doctor.user.phone || "Non Spécifié",
      },
      note: subCase.linked_cases.note || "",
      devis: subCase.linked_cases.devis[0]?.id
        ? subCase.linked_cases.devis[0].id.toString()
        : null,
      type:
        caseTypeMap[subCase.linked_cases.case_type] || "Type de cas inconnu",
      order: subCase.order, // Include the order of the subcase
    }));

    console.log("cases", cases);

    return res.status(200).json(cases);
  } catch (err) {
    console.error("Error fetching sub-cases:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.addAdditionalImages = async (req, res) => {
  additionalImagesUpload(req, res, async (error) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    try {
      const { caseId } = req.body;
      const caseIdInt = BigInt(caseId);
      const files = req.files.images;

      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded." });
      }

      // Use Promise.all to upload all files and get an array of URLs
      const fileUrls = await Promise.all(
        files.map((file) =>
          uploadSingleFile(
            file,
            parseInt(caseIdInt),
            process.env.GOOGLE_STORAGE_BUCKET_CASE_ADDITIONAL_IMAGES
          )
        )
      );

      // Check that fileUrls is an array
      if (!Array.isArray(fileUrls)) {
        return res.status(500).json({ error: "Failed to upload files." });
      }

      const existingPatientImages = await prisma.patient_images.findUnique({
        where: { case_id: caseIdInt },
        select: { additional_images: true },
      });

      if (!existingPatientImages) {
        return res.status(404).json({ error: "Patient images not found." });
      }

      // Parse the existing additional_images from JSON
      const additionalImagesArray = existingPatientImages.additional_images
        ? JSON.parse(existingPatientImages.additional_images)
        : [];

      // Ensure additionalImagesArray is an array
      if (!Array.isArray(additionalImagesArray)) {
        return res
          .status(500)
          .json({ error: "Additional images data corrupted." });
      }

      // Append new file URLs to the existing additional_images array
      additionalImagesArray.push(...fileUrls);

      // Check for the maximum number of additional images
      if (additionalImagesArray.length > 10) {
        return res
          .status(400)
          .json({ error: "Impossible de télécharger plus de 10 images" });
      }

      // Serialize the updated array to a JSON string
      const updatedAdditionalImages = JSON.stringify(additionalImagesArray);

      let updatedPatientImages = await prisma.patient_images.update({
        where: { case_id: caseIdInt },
        data: {
          additional_images: updatedAdditionalImages,
        },
        include: { patient: true },
      });

      return res.status(200).json({
        message: "Images added successfully",
        additional_images: JSON.parse(updatedPatientImages.additional_images),
      });
    } catch (error) {
      console.error("Error adding additional images:", error);
      return res.status(500).json({ error: error.message });
    }
  });
};

exports.updateAdditionalImage = async (req, res) => {
  additionalImagesUpload(req, res, async (error) => {
    // Middleware for handling single file upload
    if (error) {
      console.error("Multer error:", error);
      return res.status(500).json({ error: error.message });
    }
    try {
      const { caseId, index } = req.body; // Get case ID and index from request body
      const caseIdInt = BigInt(caseId);
      const file = req.files && req.files.images[0]; // Get uploaded file

      // Log the file for debugging
      console.log("Uploaded file:", file);

      if (!file) {
        console.error("No file uploaded.");
        return res.status(400).json({ error: "No file uploaded." });
      }

      // Upload the file and get the URL
      const fileUrl = await uploadSingleFile(
        file,
        parseInt(caseIdInt),
        process.env.GOOGLE_STORAGE_BUCKET_CASE_ADDITIONAL_IMAGES
      );

      // Fetch existing patient images from database
      const existingPatientImages = await prisma.patient_images.findUnique({
        where: { case_id: caseIdInt },
        select: { additional_images: true },
      });

      if (!existingPatientImages) {
        console.error("Patient images not found for case ID:", caseIdInt);
        return res.status(404).json({ error: "Patient images not found." });
      }

      // Parse existing images and update the specified index
      const additionalImagesArray = existingPatientImages.additional_images
        ? JSON.parse(existingPatientImages.additional_images)
        : [];

      // Ensure index is valid
      if (index >= additionalImagesArray.length || index < 0) {
        console.error("Invalid index:", index);
        return res.status(400).json({ error: "Invalid index specified." });
      }

      additionalImagesArray[index] = fileUrl;

      // Update the database with the new image
      const updatedAdditionalImages = JSON.stringify(additionalImagesArray);
      const updatedPatientImages = await prisma.patient_images.update({
        where: { case_id: caseIdInt },
        data: {
          additional_images: updatedAdditionalImages,
        },
        include: { patient: true },
      });

      return res.status(200).json({
        message: "Image updated successfully",
        additional_images: JSON.parse(updatedPatientImages.additional_images),
      });
    } catch (error) {
      console.error("Error updating additional image:", error);
      return res.status(500).json({ error: error.message });
    }
  });
};

exports.refuseCase = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }

  const caseIdInt = BigInt(id);

  try {
    const result = await prisma.$transaction(async (prisma) => {
      // 1) Fetch the case including its status history
      const caseData = await prisma.cases.findUnique({
        where: { id: caseIdInt },
        include: {
          patient: true,
          doctor: { include: { user: true } },
          devis: true,
          status_histories: true,
        },
      });

      if (!caseData) {
        throw new Error("Case not found.");
      }
      if (caseData.is_refused === 1) {
        return res
          .status(400)
          .json({ error: "This case has already been refused." });
      }

      // 2) Find "in_construction" status if it exists
      const inConstruction = caseData.status_histories.find(
        (s) => s.name === "in_construction"
      );

      // 3) Choose referenceDate: either the in_construction date, or the case's created_at
      const referenceDate = inConstruction
        ? new Date(inConstruction.created_at)
        : caseData.created_at;

      // 4) Compute due date from referenceDate (+37 days)
      const dueDate = dayjs(referenceDate).add(37, "day").toDate();

      // 5) Determine pack pricing by doctor’s country
      const doctorCountryCode = caseData.doctor.user.country;
      const pack = await prisma.packs.findFirst({
        where: { name: "SmileSet" },
      });
      if (!pack) throw new Error("Pack 'SmileSet' not found.");

      let amount, currency, invoiceRefPrefix;
      switch (doctorCountryCode) {
        case "TN":
          invoiceRefPrefix = "TN-";
          amount = pack.tnd_price;
          currency = "TND";
          break;
        case "MA":
          invoiceRefPrefix = "MA-";
          amount = pack.dhr_price;
          currency = "MAD";
          break;
        case "DZ":
          invoiceRefPrefix = "DZ-";
          amount = pack.dzd_price;
          currency = "DZD";
          break;
        default:
          invoiceRefPrefix = "EUR-";
          amount = pack.eur_price;
          currency = "EUR";
      }
      if (amount == null)
        throw new Error("Price not found for the specified country.");

      // 6) Build invoice reference string
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const invoice_ref = `${invoiceRefPrefix}${caseData.id}-${yyyy}${mm}${dd}`;

      // 7) Create or update the devis
      let devis;
      if (!caseData.devis || caseData.devis.length === 0) {
        devis = await prisma.devis.create({
          data: {
            price: amount.toString(),
            status: "accepted",
            due_date: dueDate,
            reduction: 0,
            case: { connect: { id: caseIdInt } },
          },
        });
      } else {
        devis = await prisma.devis.update({
          where: { id: caseData.devis[0].id },
          data: {
            price: amount.toString(),
          },
        });
      }

      // 8) Mark case as refused
      await prisma.cases.update({
        where: { id: caseIdInt },
        data: {
          is_refused: 1,
          refusal_reason: reason,
        },
      });

      // 9) Create the invoice
      const invoice = await prisma.invoices.create({
        data: {
          case_id: caseIdInt,
          amount: parseFloat(amount),
          payment_status: "unpaid",
          devis_id: devis.id,
          invoice_ref,
          due_date: dueDate,
          country_code: doctorCountryCode,
        },
      });

      // 10) Fetch detailed invoice for PDF generation
      const detailedInvoice = await prisma.invoices.findUnique({
        where: { id: invoice.id },
        include: {
          case: {
            include: {
              doctor: { include: { user: true } },
              packs: true,
            },
          },
        },
      });

      // Override created_at to our reference date
      detailedInvoice.case.created_at = referenceDate;

      // 11) Generate PDF and return
      const invoicePdfLink = await generateInvoicePdf(detailedInvoice);

      return {
        status: 200,
        message: "Case refused, devis and invoice created successfully.",
        invoicePdfLink,
      };
    });

    return res.status(result.status).json({
      message: result.message,
      invoicePdfLink: result.invoicePdfLink,
    });
  } catch (error) {
    console.error("Error refusing case:", error);
    logger.error("Error refusing case:", error.message);
    switch (error.message) {
      case "Case not found.":
        return res.status(404).json({ error: error.message });
      case "Pack 'SmileSet' not found.":
      case "Price not found for the specified country.":
        return res.status(500).json({ error: error.message });
      default:
        return res.status(500).json({ error: "Internal server error" });
    }
  }
};

exports.updateStatus = async (req, res) => {
  const caseId = parseInt(req.params.id, 10); // Case ID from the URL params
  const { status } = req.body; // Status from the request body

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  // Map the frontend status to the database enum value
  const dbStatus = statusFrontendEnum[status];
  if (!dbStatus) {
    return res.status(400).json({ error: "Invalid status provided" });
  }

  try {
    // Check if the case exists
    const existingCase = await prisma.cases.findUnique({
      where: { id: caseId },
    });

    if (!existingCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    // Create a new status history entry
    const newStatusHistory = await prisma.status_histories.create({
      data: {
        caseId: caseId,
        name: dbStatus, // Save the mapped status in the database
      },
    });

    // Convert BigInt fields to strings before sending the response
    const responsePayload = {
      ...newStatusHistory,
      id: newStatusHistory.id.toString(),
      caseId: newStatusHistory.caseId.toString(),
      name: statusMap[newStatusHistory.name], // Map the database status to the user-friendly name
    };

    res.status(201).json({
      message: "Status updated successfully",
      data: responsePayload,
    });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({
      error: "An error occurred while updating the status",
    });
  }
};
exports.startedStatus = async (req, res) => {
  const { caseId } = req.params;
  console.log("caseId", caseId);
  const available_cases = req.session.cases;
  console.log("req.session.cases", req.session.cases);
  console.log(
    "caseId in available_cases: ",
    available_cases.includes(Number(caseId))
  );
  if (req.session.role == "doctor") {
    if (!available_cases.includes(Number(caseId))) {
      return res.status(401).json({ error: "Unauthorized access" });
    }
  }
  try {
    const treatment = await prisma.cases.findFirst({
      where: {
        id: BigInt(caseId),
      },
      select: { treatment_started: true },
    });
    console.log("treatment", treatment);
    if (!treatment) {
      return res.status(404).json({ message: "Treatment not found" });
    }

    res.status(200).json({ started: treatment.treatment_started });
  } catch (error) {
    console.error("Error fetching started status:", error);
    res.status(500).json({ message: "Failed to fetch started status" });
  }
};
