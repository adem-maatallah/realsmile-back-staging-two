const express = require("express");
const router = express.Router();
const multer = require("multer");
const commercialController = require("../../controllers/commercialController");
const authController = require("../../controllers/authController");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post(
  "/doctors",
  authController.protect,
  authController.restrictTo("commercial"),
  upload.single("profile_picture"),
  /* schemaValidator(createDoctor), */
  commercialController.createDoctor
);

router.post(
  "/",
  authController.protect,
  authController.restrictTo("admin"),
  upload.single("profile_picture"),
  commercialController.createCommercial
);

router.get(
  "/:id",
  authController.protect,
  authController.restrictTo("admin"),
  commercialController.getCommercialById
);

router.put(
  "/:id",
  authController.protect,
  authController.restrictTo("admin"),
  upload.single("profile_picture"),
  commercialController.updateCommercial
);

router.delete(
  "/:id",
  authController.protect,
  authController.restrictTo("admin"),
  commercialController.deleteCommercial
);

router.get(
  "/",
  authController.protect,
  authController.restrictTo("admin"),
  commercialController.getAllCommercials
);

router.post(
  "/:id/assign-doctors",
  authController.protect,
  authController.restrictTo("admin"),
  upload.single("profile_picture"),
  commercialController.assignDoctors
);

module.exports = router;
