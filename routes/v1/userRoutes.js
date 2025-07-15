const express = require("express");
const router = express.Router();
const userController = require("../../controllers/userController");
const authController = require("../../controllers/authController");
const {
    createUser,
    updateUser,
    getUsers,
    checkUserId,
} = require("./schemas/userSchemas");
const {
    schemaValidator
} = require("../../middlewares/schemaValidator");

router.get(
    "/",
    authController.protect,
    /* authController.restrictTo("admin"), */
    schemaValidator(getUsers, "query"),
    userController.getUsers,
);

router.post(
    "/updateUserActivationStatus",
    authController.protect,
    authController.restrictTo("admin"),
    userController.updateUserActivationStatus,
);

router.post("/createMobileUser",
    authController.protect,
    authController.restrictTo("admin"),
    userController.createMobileUser
);

router
    .route('/roles')
    .get(
        userController.fetchRoles
    );

router
    .route("/:id")
    .get(
        authController.protect,
        authController.restrictTo("admin", "hachem"),
        schemaValidator(checkUserId, "params"),
        userController.getUser
    );


router.post(
    "/",
    /* authController.protect,
    authController.restrictTo("admin"),
    schemaValidator(createUser), */
    userController.createUser
);

router.put(
    "/:id",
    authController.protect,
    authController.restrictTo("admin"),
    /* schemaValidator(checkUserId, "params"), */
    schemaValidator(updateUser),
    userController.updateUser
);

router.delete(
    "/:id",
    authController.protect,
    authController.restrictTo("admin"),
    schemaValidator(checkUserId, "params"),
    userController.deleteUser
);

router.post(
    "/addCode", 
    authController.protect,
    authController.restrictTo("admin"),
    userController.addCodeInDevice
);
module.exports = router;