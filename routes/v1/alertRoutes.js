const express = require('express');
const router = express.Router();
const treatmentController = require('../../controllers/treatmentController');
const authController = require('../../controllers/authController');
const multer = require('multer');
const { hasAnyRole } = require('../../middlewares/roleMiddleware');

// Configure multer for file upload
const upload = multer({
    dest: 'uploads/video_upload', // Temporary storage location
    limits: { fileSize: 500 * 1024 * 1024 } // Set a file size limit (500 MB in this case)
  });

// alert requests
router.post("/:user_id", authController.protect, hasAnyRole([1,4]), upload.single('video'), treatmentController.createAlert)
router.get('/', authController.protect, hasAnyRole([1, 3, 4]), treatmentController.getAllAlerts);
// add if the user accessing is allowed to access the alerts of patient and doctor
router.get("/:user_id/doctor", authController.protect, hasAnyRole([1,3,4]),  treatmentController.getAlertsAsDoctor)
router.get("/:user_id/:patient_user_id/doctor", authController.protect, hasAnyRole([1,3,4]),  treatmentController.getAlertsForPatient)

router.get("/:user_id/patient", authController.protect, hasAnyRole([1,3,4]),  treatmentController.getAlertsAsPatient)
router.get("/:alert_id", authController.protect, hasAnyRole([1,3,4]),  treatmentController.getAlert)
router.get('/videoStatus/:videoId', authController.protect, hasAnyRole([1,3,4]), treatmentController.checkVideoStatus);
router.get('/videoObj/:videoId', authController.protect, hasAnyRole([1,3,4]), treatmentController.getVideoObj);
router.post("/:alert_id/resolve", authController.protect, hasAnyRole([1, 3]), treatmentController.resolveAlert);

// notification requests

module.exports = router;
