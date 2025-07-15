const express = require("express");
const router = express.Router();
const cdnController = require("../../controllers/cdnController");
const authController = require("../../controllers/authController");

router.post(
    "/",
    // authController.protect,
    // authController.restrictTo('admin'),
    cdnController.uploadStaticFiles
)


module.exports = router;