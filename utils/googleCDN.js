require("dotenv").config();
const { Storage } = require("@google-cloud/storage");
const path = require("path");

if (
  !process.env.GOOGLE_STORAGE_BUCKET_NAME ||
  !process.env.GOOGLE_STORAGE_KEY_FILENAME
) {
  throw new Error(
    "Missing required environment variables for Google Cloud Storage configuration."
  );
}

let serviceAccountPath = path.join(process.cwd(), "service-account.json");

// Initialize Google Cloud Storage client
const storage = new Storage({
  projectId: process.env.GOOGLE_STORAGE_PROJECT_ID,
  keyFilename: serviceAccountPath, // Path to the JSON key file
});

async function makeBucketPublic(bucketName) {
  const bucket = storage.bucket(bucketName);
  try {
    await bucket.iam.setPolicy({
      bindings: [
        {
          role: "roles/storage.objectViewer",
          members: ["allUsers"],
        },
      ],
    });
  } catch (error) {
    console.error("Failed to make bucket public:", error);
    throw error;
  }
}

async function configureCORS(bucketName) {
  const bucket = storage.bucket(bucketName);
  const corsConfiguration = [
    {
      origin: ["*"],
      responseHeader: ["Content-Type"],
      method: ["GET", "HEAD", "DELETE"],
      maxAgeSeconds: 3600,
    },
  ];

  try {
    await bucket.setCorsConfiguration(corsConfiguration);
  } catch (error) {
    console.error("Error configuring CORS:", error);
    throw error;
  }
}

async function ensureBucketExists(bucketName) {
  const bucket = storage.bucket(bucketName);
  try {
    const [exists] = await bucket.exists();

    if (!exists) {
      await storage.createBucket(bucketName, {
        location: "europe-west1", // Paris, France region
        storageClass: "STANDARD",
      });
      await makeBucketPublic(bucketName); // Set the bucket to public access
      await configureCORS(bucketName); // Configure CORS
    }
  } catch (error) {
    console.error("Error configuring bucket:", error);
    throw error;
  }
}

const uploadFiles = async (files, caseId, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);

  const uploadPromises = files.map((file) => {
    const filePath = `${directory}/${caseId}/${file.originalname}`;
    const fileUpload = bucket.file(filePath);
    const contentType = file.mimetype.startsWith("image/")
      ? "application/octet-stream"
      : file.mimetype;

    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: contentType,
        cacheControl: "public, max-age=31536000",
      },
    });

    stream.on("error", (err) => {
      console.error(`Upload error for file ${file.originalname}:`, err);
      throw err;
    });

    stream.end(file.buffer);

    return new Promise((resolve, reject) => {
      stream.on("finish", () => {
        const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
        resolve(publicUrl);
      });
    });
  });

  try {
    const listOfFilesLocation = await Promise.all(uploadPromises);
    return listOfFilesLocation;
  } catch (err) {
    console.error("Error in uploading one or more files:", err);
    throw new Error("Failed to upload one or more files.");
  }
};

const uploadStatcFiles = async (files, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);

  const uploadPromises = files.map((file) => {
    const filePath = `${directory}/${file.originalname}`;
    const fileUpload = bucket.file(filePath);
    const stream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        cacheControl: "public, max-age=31536000",
      },
    });

    stream.on("error", (err) => {
      console.error(`Upload error for file ${file.originalname}:`, err);
      throw err;
    });

    stream.end(file.buffer);

    return new Promise((resolve, reject) => {
      stream.on("finish", () => {
        const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
        resolve(publicUrl);
      });
    });
  });

  try {
    const listOfFilesLocation = await Promise.all(uploadPromises);
    return listOfFilesLocation;
  } catch (err) {
    console.error("Error in uploading one or more files:", err);
    throw new Error("Failed to upload one or more files.");
  }
};

const uploadSingleFile = async (file, caseId, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);

  // Append timestamp if the file is an image
  const fileName = `${Date.now()}_${file.originalname}`;

  const filePath = caseId
    ? `${directory}/${caseId}/${fileName}`
    : `${directory}/${fileName}`;
  const fileUpload = bucket.file(filePath);

  console.log(file.mimetype, "file.mimetype");

  const contentType =
    file.mimetype.startsWith("image/") || file.mimetype === "application/pdf"
      ? "application/octet-stream"
      : file.mimetype;

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  stream.on("error", (err) => {
    console.error(`Upload error for file ${file.originalname}:`, err);
    throw err;
  });

  stream.end(file.buffer);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      resolve(publicUrl);
    });
  });
};

const uploadSingleEcommerceFile = async (file, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);

  // Append timestamp if the file is an image
  const fileName = `${Date.now()}_${file.originalname}`;

  const filePath = `${directory}/${fileName}`;
  const fileUpload = bucket.file(filePath);

  console.log(file.mimetype, "file.mimetype");

  const contentType = file.mimetype;

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  stream.on("error", (err) => {
    console.error(`Upload error for file ${file.originalname}:`, err);
    throw err;
  });

  stream.end(file.buffer);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      resolve(publicUrl);
    });
  });
};

const uploadSingleFileReadable = async (file, caseId, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);
  const filePath = caseId
    ? `${directory}/${caseId}/${file.originalname}`
    : `${directory}/${file.originalname}`;
  const fileUpload = bucket.file(filePath);
  console.log(file.mimetype, "file.mimetype");

  const contentType = file.mimetype.startsWith("image/")
    ? "application/octet-stream"
    : file.mimetype;

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  stream.on("error", (err) => {
    console.error(`Upload error for file ${file.originalname}:`, err);
    throw err;
  });

  stream.end(file.buffer);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      resolve(publicUrl);
    });
  });
};

const uploadSingleStlFile = async (file, caseId, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);
  const filePath = caseId
    ? `${directory}/${caseId}/${file.originalname}`
    : `${directory}/${file.originalname}`;
  const fileUpload = bucket.file(filePath);
  console.log(file.mimetype, "file.mimetype");

  const contentType = "application/octet-stream";

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  stream.on("error", (err) => {
    console.error(`Upload error for file ${file.originalname}:`, err);
    throw err;
  });

  stream.end(file.buffer);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      resolve(publicUrl);
    });

    stream.on("error", (err) => {
      console.error("Error finishing the stream:", err);
      reject(err);
    });
  });
};

const uploadBinaryFile = async (file, caseId, directory) => {
  if (!file || !file.buffer) {
    console.error("No file data provided for upload");
    throw new Error("No file data provided");
  }

  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);
  const fileName = `${caseId}_${Date.now()}.pdf`; // Dynamic file name generation
  const filePath =
    caseId && directory
      ? `${directory}/${caseId}/${fileName}`
      : `${directory}/${fileName}`;
  const fileUpload = bucket.file(filePath);

  console.log("Starting binary file upload:", filePath);

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: file.mimetype || "application/octet-stream",
      cacheControl: "public, max-age=31536000",
    },
  });

  return new Promise((resolve, reject) => {
    stream.on("error", (err) => {
      console.error("Upload error:", err);
      reject(err);
    });

    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      console.log("Upload successful:", publicUrl);
      resolve(publicUrl);
    });

    stream.end(file.buffer);
  });
};

const extractImagesHandle = (images, url) => {
  if (!Array.isArray(images)) {
    images = [images];
  }
  return images
    .filter((image) => image)
    .map((image) => {
      return image.includes("http://") || image.includes("https://")
        ? image
        : `${url}${image}`;
    });
};

const extractStlsHandle = (stls, url) => {
  if (!Array.isArray(stls)) {
    stls = [stls];
  }
  return stls
    .filter((stl) => stl)
    .map((stl) => {
      return stl.includes("http://") || stl.includes("https://")
        ? stl
        : `${url}${stl}`;
    });
};

const uploadDoctorProfilePic = async (file, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);
  const filePath = `${directory}/${file.originalname}`;
  const fileUpload = bucket.file(filePath);

  const contentType = file.mimetype.startsWith("image/")
    ? "application/octet-stream"
    : file.mimetype;

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  stream.on("error", (err) => {
    console.error(`Upload error for file ${file.originalname}:`, err);
    throw err;
  });

  stream.end(file.buffer);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      resolve(publicUrl);
    });
  });
};

const uploadSingleChatFile = async (file, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);
  const filePath = `${directory}/${file.originalname}`;
  const fileUpload = bucket.file(filePath);

  const contentType =
    file.mimetype.startsWith("image/") || file.mimetype === "application/pdf"
      ? "application/octet-stream"
      : file.mimetype;

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  stream.on("error", (err) => {
    console.error(`Upload error for file ${file.originalname}:`, err);
    throw err;
  });

  stream.end(file.buffer);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      resolve(publicUrl);
    });
  });
};

const uploadSingleNotificationFile = async (file, directory) => {
  const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME);
  const filePath = `${directory}/${file.originalname}`;
  const fileUpload = bucket.file(filePath);

  const contentType =
    file.mimetype.startsWith("image/") || file.mimetype === "application/pdf"
      ? "application/octet-stream"
      : file.mimetype;

  const stream = fileUpload.createWriteStream({
    metadata: {
      contentType: contentType,
      cacheControl: "public, max-age=31536000",
    },
  });

  stream.on("error", (err) => {
    console.error(`Upload error for file ${file.originalname}:`, err);
    throw err;
  });

  stream.end(file.buffer);

  return new Promise((resolve, reject) => {
    stream.on("finish", () => {
      const publicUrl = `https://storage.googleapis.com/${process.env.GOOGLE_STORAGE_BUCKET_NAME}/${filePath}`;
      resolve(publicUrl);
    });
  });
};

async function deleteFileFromStorage(bucketName, fileUrl) {
  try {
    const bucket = storage.bucket(bucketName);
    const urlParts = fileUrl.split("/");
    const fileName = urlParts[urlParts.length - 1];
    await bucket.file(fileName).delete();
    console.log(`File ${fileName} deleted successfully.`);
  } catch (error) {
    console.error("Error deleting file:", error);
    throw error;
  }
}

exports.uploadFiles = uploadFiles;
exports.extractImagesHandle = extractImagesHandle;
exports.ensureBucketExists = ensureBucketExists;
exports.uploadStatcFiles = uploadStatcFiles;
exports.uploadSingleFile = uploadSingleFile;
exports.extractStlsHandle = extractStlsHandle;
exports.uploadDoctorProfilePic = uploadDoctorProfilePic;
exports.uploadBinaryFile = uploadBinaryFile;
exports.uploadSingleFileReadable = uploadSingleFileReadable;
exports.uploadSingleStlFile = uploadSingleStlFile;
exports.uploadSingleChatFile = uploadSingleChatFile;
exports.uploadSingleNotificationFile = uploadSingleNotificationFile;
exports.uploadSingleEcommerceFile = uploadSingleEcommerceFile;
exports.deleteFileFromStorage = deleteFileFromStorage;
