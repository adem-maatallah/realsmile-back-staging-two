const express = require("express");
const asyncHandler = require("express-async-handler");
const router = express.Router();
const treatmentController = require("../../controllers/treatmentController");
const authController = require("../../controllers/authController");

const { isDoctor, hasAnyRole } = require("../../middlewares/roleMiddleware");
const multer = require("multer");

// Configure multer for file upload
const upload = multer({
  dest: "uploads/video_upload", // Temporary storage location
  // storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // Set a file size limit (500 MB in this case)
});
// Treatment routes
// router.get('/', authController.protect, hasAnyRole([1,3,4]), treatmentController.getTreatments);
router.get(
  "/:id",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.getTreatment
);

// router.get('/:id', treatmentController.getTreatment);
// router.get('/:id/:caseId/:treatmentNumbers', treatmentController.getTreatmentNumber);

// treatment requests
router.patch("/treatment-step/:case_id", treatmentController.getTreatmentStep);
router.patch("/", treatmentController.updateTreatments);
router.get(
  "/cases/:caseId",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.getTreatmentsByCaseId
);
router.post(
  "/",
  authController.protect,
  /* hasAnyRole([1, 4]), */
  treatmentController.createTreatment
);
router.delete(
  "/:case_id",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.deleteTreatment
);

router.post(
  "/verifyTreatmentSlot/:currentSlotId",
  authController.protect,
  hasAnyRole([1, 4]),
  treatmentController.verifyTreatmentSlot
);
router.get(
  "/videoObj/:videoId",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.getVideoObj
);
router.post(
  "/videoObj",
  authController.protect,
  hasAnyRole([1, 4]),
  upload.single("video"),
  treatmentController.postVideoObj
);
router.delete(
  "/deleteVideoObj/:videoId",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.deleteVideoObj
);
router.get(
  "/videoStatus/:videoId",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.checkVideoStatus
);
router.patch(
  "/updateFinalizedStatus",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.finalizeUpdate
);
router.patch("/updateVideoLink", treatmentController.updateVideoLink);
router.patch(
  "/:caseId/updateStartDate",
  authController.protect,
  hasAnyRole([1, 4]),
  treatmentController.updateFirstTreatmentStartDate
);

router.patch(
  "/:id/finalize",
  authController.protect,
  hasAnyRole([1, 4]),
  treatmentController.finalizeTreatment
);

router.patch(
  "/:id/updateTreatmentSlotStatus",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.updateTreatmentSlot
);
router.patch(
  "/cases/:caseId/updateStatuses",
  authController.protect,
  hasAnyRole([1, 4]),
  treatmentController.updateTreatmentsByCaseId
);

// comment requests
router.post(
  "/comments",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.postComment
);
router.get(
  "/comment/:case_id/:treatment_id",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.getAllComments
);

// notification requests

router.post(
  "/notification",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.createNotification
);
router.get(
  "/notification/:receiver_id",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.getNotifications
);
router.put(
  "/notification/:notification_id/mark-checked",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  treatmentController.markNotificationAsChecked
);

router.put("/:id/update-videos", treatmentController.updateTreatmentVideos);
router.post(
  "/:treatmentId/upload-videos",
  treatmentController.uploadTreatmentVideos
);
router.get(
  "/cases/:caseId/latest",
  treatmentController.getLatestTreatmentByCaseId
);
router.get("/:treatmentId/images", treatmentController.getTreatmentsImages);
// to update the intra-oral images by the doctor, 1/remove that image, 2/update it, or directly update it without removing:
router.put(
  "/:treatmentId/remove-intraoral-image",
  treatmentController.removeIntraOralImage
);
router.put("/update-intraoral-image", treatmentController.updateIntraOralImage);

// router.get('/stls/:treatmentId',treatmentController.getTreatmentSTLs);

// New:
// the doctor removes any videos taken and inform patient to retake the videos removed through notification:
router.put(
  "/:treatmentId/remove-videos",
  authController.protect,
  isDoctor,
  treatmentController.retakeVideo
);

module.exports = router;