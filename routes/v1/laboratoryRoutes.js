const express = require("express");
const router = express.Router();
const laboratoryController = require("../../controllers/laboratoryController");
const authController = require("../../controllers/authController");

router.get(
  "/laboCasesInTreatment",
  authController.protect,
  authController.restrictTo("admin", "labo", "hachem"),
  laboratoryController.getLaboCasesInTreatment
);

router.get(
  "/laboratoryCaseFiles/:id",
  authController.protect,
  authController.restrictTo("admin", "labo"),
  laboratoryController.getCaseDetailsWithSTLsAndImages
);

router.get(
  "/laboratoryCaseIiwgl/:id",
  authController.protect,
  authController.restrictTo("admin", "labo"),
  laboratoryController.getLaboCaseIiwgl
);

router.post(
  "/addIiwglLink",
  authController.protect,
  authController.restrictTo("admin", "labo"),
  laboratoryController.addIiwglLink
);

module.exports = router;
