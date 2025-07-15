// utils/invoiceUtils.js
const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");
const { invoicesDbStatusMap } = require("../enums/devisEmun");
const { statusDbEnum } = require("../enums/caseEnum");
const prisma = new PrismaClient().$extends(withAccelerate());

const createInvoice = async ({
  case_id,
  status,
  devis_id,
  amount,
  reduction,
}) => {
  try {
    // Validate the required fields
    if (!case_id) {
      throw new Error("case_id is required");
    }

    // Fetch the case to get the doctor details and status history
    const caseData = await prisma.cases.findUnique({
      where: { id: BigInt(case_id) },
      include: {
        doctor: {
          include: {
            user: true,
          },
        },
        status_histories: {
          orderBy: {
            id: "desc",
          },
        },
      },
    });

    if (!caseData) {
      throw new Error("Case not found");
    }

    // Check if the last status is 'in_construction'
    const lastStatus = caseData.status_histories.find(
      (status) => status.name === statusDbEnum.in_construction
    );

    if (!lastStatus) {
      throw new Error("The last status is not 'in_construction'");
    }

    // Pass the in_construction status created_at to case.created_at
    caseData.created_at = new Date(lastStatus.created_at);

    const redesignRequestedDate = new Date(lastStatus.created_at);
    const dueDate = new Date(redesignRequestedDate);
    dueDate.setDate(dueDate.getDate() + 37); // Add 37 days to the redesign requested date

    // Generate the invoice_ref based on doctor's user country
    const doctorCountry = caseData?.doctor?.user?.country;
    let invoiceRefPrefix;
    let initialInvoiceNumber;

    switch (doctorCountry) {
      case "TN":
        invoiceRefPrefix = "TN-";
        initialInvoiceNumber = 500;
        break;
      case "MA":
        invoiceRefPrefix = "MA-";
        initialInvoiceNumber = 500;
        break;
      default:
        invoiceRefPrefix = "EUR-";
        initialInvoiceNumber = 0;
    }

    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0"); // Add 1 because months are zero-indexed
    const day = String(currentDate.getDate()).padStart(2, "0");

    // Fetch the latest invoice number for the country prefix
    const latestInvoice = await prisma.invoices.findFirst({
      where: {
        invoice_ref: {
          startsWith: invoiceRefPrefix,
        },
      },
      orderBy: {
        id: "desc",
      },
    });

    let nextInvoiceNumber = initialInvoiceNumber;
    if (latestInvoice) {
      const latestInvoiceRef = latestInvoice.invoice_ref.split("-")[1];
      const latestInvoiceNumber = parseInt(latestInvoiceRef.split("-")[0], 10);
      nextInvoiceNumber = latestInvoiceNumber + 1;
    }

    const invoice_ref = `${invoiceRefPrefix}${nextInvoiceNumber}-${year}${month}${day}`; // Format: PREFIXNUMBER-YYYYMMDD

    // If amount and reduction are not provided, fetch them from the devis
    if (!amount || !reduction) {
      if (!devis_id) {
        throw new Error("devis_id is required to fetch amount and reduction");
      }

      const devis = await prisma.devis.findUnique({
        where: { id: BigInt(devis_id) },
      });

      if (!devis) {
        throw new Error("Devis not found");
      }

      if (!amount) {
        amount = parseFloat(devis.price);
      }
      if (!reduction) {
        reduction = parseFloat(devis.reduction);
      }
    }

    // Apply reduction if it is not zero
    if (reduction !== 0) {
      amount = amount * (1 - reduction / 100);
    }

    // Ensure amount is a positive number
    if (amount <= 0) {
      throw new Error("Amount must be a positive number");
    }

    // Create a new invoice
    const newInvoice = await prisma.invoices.create({
      data: {
        case_id: BigInt(case_id),
        amount,
        payment_status: status || invoicesDbStatusMap.unpaid,
        devis_id: devis_id ? BigInt(devis_id) : null,
        invoice_ref,
        due_date: dueDate,
        country_code: doctorCountry,
      },
    });

    return await prisma.invoices.findUnique({
      where: { id: newInvoice.id },
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
        devis: true,
      },
    });
  } catch (error) {
    throw new Error(`Error creating invoice: ${error.message}`);
  }
};

module.exports = { createInvoice };
