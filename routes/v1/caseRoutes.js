const express = require("express");
const router = express.Router();
const caseController = require("../../controllers/caseController");
const authController = require("../../controllers/authController");

router.get(
  "/",
  authController.protect,
  authController.restrictTo("admin", "doctor", "hachem", "labo", "commercial"),
  caseController.getCases
);

router.get(
  "/realsmile-ai",
  authController.protect,
  authController.restrictTo("admin", "doctor", "hachem", "labo", "commercial"),
  caseController.getRealSmileAICases
);

router.get(
  "/laboCases",
  authController.protect,
  authController.restrictTo("admin", "labo"),
  caseController.getLaboCases
);

router.get(
  "/laboCasesTreatmentStatus",
  // authController.protect,
  // authController.restrictTo('admin', 'labo'),
  caseController.getLaboCasesTreatmentStatus
);

router.get(
  "/images",
  authController.protect,
  authController.restrictTo("admin", "doctor", "patient", "labo", "commercial"),
  caseController.getCaseImages
);

router.get(
  "/stls",
  authController.protect,
  authController.restrictTo("admin", "doctor", "patient", "labo", "commercial"),
  caseController.getStls
);

router.get(
  "/getStep1InfoByCaseId/:caseId",
  authController.protect,
  authController.restrictTo("admin", "doctor", "patient", "labo", "commercial"),
  caseController.getStep1InfoByCaseId
);

router.get(
  "/getSubCases/:caseId",
  authController.protect,
  authController.restrictTo("admin", "doctor"),
  caseController.getSubCases
);

// Route to get a case by ID
router.get(
  "/:id",
  authController.protect,
  authController.restrictTo("admin", "doctor", "hachem", "commercial"),
  // schemaValidator(checkUserId, "params"),
  caseController.getCaseById
);

router.get("/generatePdf/:caseId", caseController.generatePdf);

router.post(
  "/",
  // authController.protect,
  // authController.restrictTo("admin", "doctor"),
  caseController.createCaseWithPatientData
);

router.post(
  "/create-old-invoices",
  // authController.protect,
  // authController.restrictTo("admin", "doctor"),
  caseController.createOldInvoices
);

router.post(
  "/updateNote",
  authController.protect,
  authController.restrictTo("admin"),
  caseController.updateCaseNotes
);

router.post(
  "/changeStatusToExpidie",
  authController.protect,
  authController.restrictTo("admin", "hachem"),
  caseController.changeStatusToExpidie
);

router.post(
  "/createCaseInConstructionFile",
  // authController.protect,
  caseController.createCaseInConstructionFile
);

router.post(
  "/changeStatusToRejected",
  // authController.protect,
  caseController.changeStatusToRejected
);

router.post(
  "/changeStatusToComplete",
  // authController.protect,
  caseController.changeStatusToComplete
);

router.put(
  "/upload-image",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.insertCaseImages
);

router.put(
  "/updateIntreatment",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.updateCaseToInTreatment
);

router.get(
  "/:caseId/status",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.getCaseStatus
);

router.put(
  "/upload-stl",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.insertCaseStls
);

router.post(
  "/step1",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.stepOne
);

router.post(
  "/step1-ai",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.stepOneWithBeforeImage
);

router.post(
  "/create-case",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.createCase
);

router.post(
  "/step4",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.step4
);

router.post(
  "/step56",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.step56
);

router.post(
  "/step7",
  authController.protect,
  authController.restrictTo("admin", "doctor", "commercial"),
  caseController.step7
);

router.post(
  "/command",
  authController.protect,
  authController.restrictTo("admin", "doctor"),
  caseController.commandCase
);

router.post(
  "/renumere",
  authController.protect,
  authController.restrictTo("admin", "doctor"),
  caseController.renumereCase
);

router.put(
  "/renumere-instructions",
  authController.protect,
  authController.restrictTo("admin", "doctor"),
  caseController.renumereCaseInstructions
);

router.delete("/:id", authController.protect, caseController.deleteCase);

router.put(
  "/update-additional-image",
  authController.protect,
  caseController.updateAdditionalImage
);

router.put(
  "/add-additional-images",
  authController.protect,
  caseController.addAdditionalImages
);

router.put(
  "/refuse-case/:id",
  authController.protect,
  authController.restrictTo("admin", "doctor"),
  caseController.refuseCase
);

router.put(
  "/update-status/:id",
  authController.protect,
  authController.restrictTo("admin"),
  caseController.updateStatus
);

router.get('/:caseId/start-status',
  authController.protect,
  authController.restrictTo('admin', 'doctor', 'patient'),
   caseController.startedStatus);

module.exports = router;
