const express = require("express");
const router = express.Router();
const patientController = require("../../controllers/patientController");
const { schemaValidator } = require("../../middlewares/schemaValidator");
const authenticateToken = require("../../middlewares/userMiddleware");
const authController = require("../../controllers/authController");

router.get(
  "/",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  patientController.getPatients
);
//reset password
router.post("/send-reset-otp", patientController.sendResetOtp);
router.post("/verify-reset-otp", patientController.verifyResetOtp);
router.post("/reset-password", patientController.resetPassword);
module.exports = router;
