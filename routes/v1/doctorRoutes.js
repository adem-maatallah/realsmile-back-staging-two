const express = require("express");
const router = express.Router();
const doctorController = require("../../controllers/doctorController");
const authController = require("../../controllers/authController");
const { createDoctor } = require("./schemas/userSchemas");
const { schemaValidator } = require("../../middlewares/schemaValidator");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get(
  "/",
  authController.protect,
  authController.restrictTo("admin", "commercial"),
  doctorController.getAll
);

router.post("/send-otp", doctorController.sendOtp);

router.post("/verify-otp", doctorController.verifyOtp);

router.post(
  "/",
  upload.single("profile_picture"),
  /* schemaValidator(createDoctor), */
  doctorController.createDoctor
);

router.get(
  "/stats",
  authController.protect,
  authController.restrictTo("doctor"),
  doctorController.doctorCaseStatistics
);
router.get(
  "/details/:id", // This expects an 'id' parameter
  doctorController.getDoctorDetails
);

router.get("/locations", 
  // authController.protect,
  doctorController.getDoctorLocations);

module.exports = router;
