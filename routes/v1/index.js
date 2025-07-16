const express = require("express");
const router = express.Router();
const contactRoutes = require('./contactRoutes'); // <-- Path adjusted

const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const patientRoutes = require("./patientRoutes");
const doctorRoutes = require("./doctorRoutes");
const userController = require("../../controllers/userController");
const authController = require("../../controllers/authController");
const caseRoutes = require("./caseRoutes");
const iiwglRoutes = require("./iiwglRoutes");
const cdnRoutes = require("./cdnRoutes");
const notificationRoutes = require("./notificationRoutes");
const laboratoryRoutes = require("./laboratoryRoutes");

const packRoutes = require("./packRoutes");
const devisRoutes = require("./devisRoutes");
const retainingGuttersRoutes = require("./retainingGuttersRoutes");
const chatRoutes = require("./chatRoutes");
const bannerRoutes = require("./bannerRoutes");
const categoryRoutes = require("./categoryRoutes");
const productRoutes = require("./productRoutes");
const orderRoutes = require("./orderRoutes");
const cartRoutes = require("./cartRoutes");
const commercialRoutes = require("./commercialRoutes");
const treatmentRoutes = require("./treatmentRoutes");
const alertRoutes = require("./alertRoutes");
const locationRoutes = require("./locationRoutes");
const { generateInvoicePdf } = require("../../utils/caseUtils");
const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());

router.use("/", authRoutes);
router.use("/patients", patientRoutes);
router.use("/doctors", doctorRoutes);
router.use("/commercials", commercialRoutes);
router.use("/users", userRoutes);
router.use("/cases", caseRoutes);
router.use("/iiwgl", iiwglRoutes);
router.use("/cdn", cdnRoutes);
router.use('/contact', contactRoutes); // Base route for contact functionalities

router.use("/notifications", notificationRoutes);
router.use("/laboratories", laboratoryRoutes);
router.use("/packs", packRoutes);
router.use("/devis", devisRoutes);
router.use("/retainingGutters", retainingGuttersRoutes);
router.use("/chat", chatRoutes);
router.use("/banners", bannerRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/carts", cartRoutes);
router.use("/orders", orderRoutes);
router.use("/treatments", treatmentRoutes);
router.use("/alerts", alertRoutes);
router.use("/locations", locationRoutes);

router.get(
  "/admin-dashboard/practitioners-patients",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getPractitionersPatientsData
);

router.get(
  "/admin-dashboard/cases-summary",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getCasesSummaryData
);

router.get(
  "/admin-dashboard/smileset",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getSmilesetData
);

router.get(
  "/admin-dashboard/packs",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getPacksData
);

// Invoice Statistics Route
router.get(
  "/admin-dashboard/invoice-statistics",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getInvoiceStatistics
);

// Total Amount Due Route
router.get(
  "/admin-dashboard/total-due",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getTotalDueByMarket
);

router.get(
  "/admin-dashboard/top-clients",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getTopClients
);

router.get(
  "/admin-dashboard/internal-statistics",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getInternalStatistics
);

router.get(
  "/admin-dashboard/numbers-overview",
  authController.protect,
  authController.restrictTo("admin"),
  userController.getNumbersOverview
);

router.get(
  "/admin-dashboard/generate-invoice-pdfs",
  async (req, res) => {
    try {
      const { secret, invoiceIds } = req.body;

      if (secret !== process.env.SECRET) {
        return res.status(401).send("Invalid request");
      }

      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).send("Invalid or missing invoice IDs");
      }

      // Fetch the specified invoices
      const invoices = await prisma.invoices.findMany({
        where: {
          id: {
            in: invoiceIds.map((id) => BigInt(id)), // Convert IDs to BigInt
          },
        },
        include: {
          case: {
            include: {
              doctor: {
                include: {
                  user: true,
                },
              },
              packs: true,
            },
          },
        },
        orderBy: {
          created_at: "desc",
        },
      });

      // Iterate over each invoice and generate a PDF
      for (const invoice of invoices) {
        const pdfUrl = await generateInvoicePdf(invoice);
        await prisma.invoices.update({
          where: { id: invoice.id },
          data: { pdf_link: pdfUrl },
        });
      }

      // Send a response
      res
        .status(200)
        .send("Invoice PDFs generated successfully for the specified invoices");
    } catch (error) {
      console.error("Error generating PDFs:", error);
      res.status(500).send("An error occurred while generating PDFs");
    }
  },
  authController.protect,
  authController.restrictTo("admin")
);

router.get("/send-email", authController.forgotPassword);

module.exports = router;
