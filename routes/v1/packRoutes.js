const express = require("express");
const router = express.Router();
const { schemaValidator } = require("../../middlewares/schemaValidator");
const packController = require("../../controllers/packController");
const authController = require("../../controllers/authController");

router.get("/", authController.protect, packController.fetchAll);
router.get("/allpacks", authController.protect, packController.fetchAllPacks);

module.exports = router;
