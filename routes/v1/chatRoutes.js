const express = require("express");
const router = express.Router();
const authController = require("../../controllers/authController");
const chatController = require("../../controllers/chatController");

router.post(
    "/uploadChatFiles",
    authController.protect,
    authController.restrictTo("doctor", "admin"),
    chatController.uploadChatFiles
);

router.post(
    "/createMobileUser",
    authController.protect,
    authController.restrictTo("doctor", "admin"),
    chatController.createMobileUser
);

module.exports = router;
