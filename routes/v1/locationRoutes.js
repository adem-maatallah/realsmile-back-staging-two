const express = require("express");
const router = express.Router();
const { schemaValidator } = require("../../middlewares/schemaValidator");
const authController = require("../../controllers/authController");
const locationController = require("../../controllers/locationController");

router.post("/",
    authController.protect,
    locationController.createLocation
)

router.get("/",
    authController.protect,
    locationController.getLocation
)
module.exports = router;
