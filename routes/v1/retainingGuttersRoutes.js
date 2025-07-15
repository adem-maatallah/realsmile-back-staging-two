const express = require("express");
const router = express.Router();
const retainingGuttersController = require("../../controllers/retainingGuttersController");
const authController = require("../../controllers/authController");

router.post(
  "/create",
  authController.protect,
  authController.restrictTo("doctor", "admin"),
  retainingGuttersController.createRetainingGutterWithPatientData
);

router.get(
  "/",
  authController.protect,
  authController.restrictTo("doctor", "admin", "hachem"),
  retainingGuttersController.getAllRetainingGutters
);

router.put(
  "/",
  authController.protect,
  authController.restrictTo("hachem"),
  retainingGuttersController.sendRetainingGutters
);

module.exports = router;
