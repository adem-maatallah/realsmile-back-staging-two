const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Configure Google Cloud Storage
const storage = new Storage({
  projectId: process.env.GOOGLE_STORAGE_PROJECT_ID, // Replace with your project ID
  keyFilename: process.env.GOOGLE_STORAGE_KEY_FILENAME, // Path to your service account key file
});

// Reference your bucket
const bucket = storage.bucket(process.env.GOOGLE_STORAGE_BUCKET_NAME); // Your bucket name

// Custom multer storage for Google Cloud Storage
const gcStorage = multer({
  storage: multer.memoryStorage(), // Store files in memory temporarily
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB file size limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload an image.'), false);
    }
  },
}).single('profile_pic'); // 'profile_pic' is the field name for file uploads

// Middleware to upload the file to Google Cloud Storage
const uploadToGoogleCloud = async (req, res, next) => {
  gcStorage(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return next();
    }

    const blob = bucket.file(`profile_pics/${Date.now()}-${req.file.originalname}`);
    const blobStream = blob.createWriteStream({
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    blobStream.on('error', (err) => {
      console.error('Error uploading to Google Cloud:', err);
      return res.status(500).json({ error: 'Failed to upload file to Google Cloud Storage' });
    });

    blobStream.on('finish', () => {
      // Construct the public URL for the uploaded file
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      req.file.cloudStoragePublicUrl = publicUrl; // Attach the public URL to the request object
      next();
    });

    blobStream.end(req.file.buffer); // Stream the file buffer to Google Cloud Storage
  });
};

module.exports = uploadToGoogleCloud;