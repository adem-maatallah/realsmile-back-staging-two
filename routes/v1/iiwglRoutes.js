const express = require("express");
const router = express.Router();
const { schemaValidator } = require("../../middlewares/schemaValidator");
const iiwglController = require("../../controllers/iiwglController");
const authController = require("../../controllers/authController");

router.post(
  "/doctorUpdateIIWGLLinkStatus",
  authController.protect,
  authController.restrictTo("admin", "doctor"),
  iiwglController.doctorUpdateIIWGLLinkStatus
);

router.post(
  "/adminUpdateIIWGLLinkStatus",
  authController.protect,
  authController.restrictTo("admin"),
  iiwglController.adminUpdateIIWGLLinkStatus
);

router.put(
  "/update-doctor-note",
  authController.protect,
  authController.restrictTo("doctor"),
  iiwglController.updateDoctorNote
);

router.put(
  "/update-admin-note",
  authController.protect,
  authController.restrictTo("admin"),
  iiwglController.updateAdminNote
);

module.exports = router;
