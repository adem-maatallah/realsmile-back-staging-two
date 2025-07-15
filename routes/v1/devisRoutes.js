const express = require("express");
const router = express.Router();
const devisController = require("../../controllers/devisController");
const authController = require("../../controllers/authController");

router.get(
  "/",
  authController.protect,
  authController.restrictTo("doctor", "admin", "hachem"),
  devisController.fetchAll
);

router.get(
  "/invoices",
  authController.protect,
  authController.restrictTo("doctor", "admin", "hachem", "finance"),
  devisController.fetchAllInvoices
);

router.get(
  "/invoices/doctors/:id",
  authController.protect,
  authController.restrictTo("doctor", "admin", "commercial"),
  devisController.fetchAllInvoicesByDoctor
);

router.get(
  "/partial-payments/doctors/:id",
  authController.protect,
  authController.restrictTo("doctor", "admin", "commercial"),
  devisController.fetchAllPartialPaymentsByDoctor
);

router.put(
  "/invoices/doctors/:id/add-payment",
  authController.protect,
  authController.restrictTo("admin", "commercial"),
  devisController.addPaymentToDoctor
);

router.get(
  "/invoices/:id",
  authController.protect,
  authController.restrictTo("doctor", "admin", "hachem", "finance"),
  devisController.fetchInvoiceById
);

router.delete(
  "/invoices/:id",
  authController.protect,
  authController.restrictTo("admin"),
  devisController.deleteInvoice
);

router.get(
  "/:id",
  authController.protect,
  authController.restrictTo("doctor", "admin", "hachem"),
  devisController.getDevisById
);

router.post(
  "/payment",
  authController.protect,
  authController.restrictTo("doctor", "admin"),
  devisController.updateInvoiceToPaid
);

router.put(
  "/invoices/:invoiceId",
  authController.protect,
  authController.restrictTo("admin"),
  devisController.updateInvoiceAmount
);

module.exports = router;
