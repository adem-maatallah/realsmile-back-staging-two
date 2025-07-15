const express = require("express");
const router = express.Router();
const cartController = require("../../controllers/cartController");
const authController = require("../../controllers/authController");

// Cart routes
router.get(
  "/:customerId",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  cartController.getCartByCustomerId
);
router.post(
  "/",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  cartController.addProductToCart
);
router.put(
  "/:customerId/:productId",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  cartController.modifyProductQuantity
);
router.delete(
  "/:customerId/:productId",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  cartController.clearCartItem
);
router.delete(
  "/:customerId",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  cartController.clearAllCartItems
);

module.exports = router;
