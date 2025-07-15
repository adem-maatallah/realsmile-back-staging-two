const bannerController = require("../../controllers/bannerController");
const express = require("express");
const router = express.Router();

router.get("/", bannerController.fetchAll);

module.exports = router;
