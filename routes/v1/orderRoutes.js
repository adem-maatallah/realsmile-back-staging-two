const express = require("express");
const router = express.Router();
const orderController = require("../../controllers/orderController");
const authController = require("../../controllers/authController");

// Order routes
router.get("/", authController.protect, orderController.getOrders);
router.get(
  "/reference/:reference",
  authController.protect,
  orderController.getOrderByReference
);
router.post("/", authController.protect, orderController.createOrder);
router.put(
  "/:reference",
  authController.protect,
  orderController.updateOrderStatus
);
router.delete("/:id", authController.protect, orderController.deleteOrder);

// Add routes for shipping and confirming shipment
router.post(
  "/:reference/shipping",
  authController.protect,
  authController.restrictTo("admin"), // Only admins can set shipping
  orderController.setToShipping
);

router.post(
  "/:reference/confirm-shipment",
  authController.protect,
  authController.restrictTo("doctor"), // Only doctors can confirm shipment
  orderController.confirmShipment
);

router.post(
  "/:reference/approve",
  authController.protect,
  authController.restrictTo("admin"), // Only doctors can confirm order
  orderController.approveOrder
);

module.exports = router;
