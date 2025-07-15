const { PrismaClient } = require("@prisma/client");
const {
  generalLinkStatusMap,
  doctorLinkStatusMap,
  adminLinkStatusMap,
} = require("../enums/iiwglEnum");
const { statusDbEnum } = require("../enums/caseEnum");
const { devisDbStatusMap, invoicesDbStatusMap } = require("../enums/devisEmun");
const { withAccelerate } = require("@prisma/extension-accelerate");
const sendEmail = require("../utils/email");
const admin = require("firebase-admin");
const prisma = new PrismaClient().$extends(withAccelerate());
const { doctorFirestore, db } = require("../utils/firebaseConfig");
const { doc, updateDoc, arrayUnion, getDoc } = require("firebase/firestore");
const { createInvoice } = require("../utils/devisUtils");
const os = require("os");
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const { uploadSingleFile } = require("../utils/googleCDN");
const { generateInvoicePdf } = require("../utils/caseUtils");
const queueEmail = require("../utils/email");

process.env.XDG_RUNTIME_DIR = "/tmp/runtime-root";

exports.adminUpdateIIWGLLinkStatus = async (req, res) => {
  const { linkId, status, packId, reduction, note } = req.body;
  const userID = parseInt(req.user.id);
  console.log("Request body:", req.body);
  // Validate request body
  if (!linkId || !status || !userID) {
    return res.status(400).json({
      message: "Missing required fields",
    });
  }

  // Convert object values to an array and check for inclusion
  if (!Object.values(adminLinkStatusMap).includes(status)) {
    console.log("Invalid status provided:", status);
    return res.status(400).json({
      message: "Invalid status provided",
    });
  }

  try {
    const user = await prisma.users.findUnique({
      where: {
        id: userID,
      },
    });
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const currentLink = await prisma.labo_links.findUnique({
      where: {
        id: linkId,
      },
      include: {
        case: {
          select: {
            doctor: {
              select: {
                user: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (
      !currentLink ||
      currentLink.admin_validation_status !== generalLinkStatusMap.not_treated
    ) {
      return res.status(400).json({
        message: "Link status cannot be changed once set",
      });
    }

    const data = {
      validated_by_admin: user.id,
      admin_validation_status: status.toLowerCase(),
    };
    if (status.toLowerCase() === adminLinkStatusMap.rejected) {
      data.admin_note = note;
    }

    const updatedLink = await prisma.labo_links.update({
      where: {
        id: linkId,
      },
      data: data,
    });

    let customerNotification = null;

    if (status.toLowerCase() === adminLinkStatusMap.accepted) {
      console.log("Pack ID:", BigInt(packId));
      const pack = await prisma.packs.findUnique({
        where: {
          id: BigInt(packId),
        },
      });
      console.log("Pack:", pack);

      if (!pack) {
        throw new Error("Invalid pack selected");
      }
      await prisma.status_histories.create({
        data: {
          name: statusDbEnum.needs_approval,
          case: {
            connect: {
              id: BigInt(currentLink.case_id), // Ensure this is the correct identifier field for your cases table
            },
          },
          created_at: new Date(),
        },
      });

      await prisma.cases.update({
        where: {
          id: BigInt(currentLink.case_id),
        },
        data: {
          packs: {
            connect: {
              id: BigInt(packId),
            },
          },
        },
      });

      // Fetch the case to get the doctor ID and patient details
      const caseData = await prisma.cases.findUnique({
        where: {
          id: BigInt(currentLink.case_id),
        },
        select: {
          doctor: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  country: true, // Fetch country for pricing
                },
              },
            },
          },
          patient: {
            select: {
              first_name: true,
              last_name: true,
            },
          },
        },
      });
      if (!caseData) {
        throw new Error("Case not found");
      }

      const patientName = `${caseData.patient.first_name} ${caseData.patient.last_name}`;

      let priceField;
      switch (caseData.doctor.user.country) {
        case "TN":
          priceField = "tnd_price";
          break;
        case "MA":
          priceField = "drh_price";
          break;
        default:
          priceField = "eur_price";
      }

      const price = pack[priceField];
      await prisma.devis.create({
        data: {
          case: {
            connect: {
              id: BigInt(currentLink.case_id),
            },
          },
          price: price.toString(),
          reduction: parseInt(reduction) ? parseInt(reduction) : 0,
          created_at: new Date(),
          due_date: new Date(new Date().setDate(new Date().getDate() + 7)),
        },
      });

      const templatePath = "templates/email/needs-approval.html"; // Provide the path to your HTML template
      const templateData = {
        caseUrl: process.env.CLIENT_URL + "/cases/" + currentLink.case_id,
        patientName: patientName,
      };

      await queueEmail({
        emails: [caseData.doctor.user.email],
        subject: `Approbation requise (cas #${currentLink.case_id})`,
        templatePath: templatePath,
        templateData: templateData,
      });

      customerNotification = {
        xa1: caseData.doctor.user.id.toString(),
        xa2: `Approbation requise (cas #${currentLink.case_id})`,
        xa3: `Nous vous informons que le SmileSet de votre patient ${patientName} nécessite votre approbation. Veuillez vérifier et approuver le cas sur la plateforme Realsmile. Merci, L'équipe Realsmile`,
        xa5: "",
        xa9: caseData.doctor.user.email,
        xd1: doctorFirestore.Timestamp.now().toMillis(),
        xf4: false,
      };

      // Reference to the customer's customernotifications document
      const customerNotificationsDocRef = doc(
        db,
        "customers",
        caseData.doctor.user.id.toString(),
        "customernotifications",
        "customernotifications"
      );

      // Check if the customer notifications document exists
      const customerDocSnap = await getDoc(customerNotificationsDocRef);
      if (customerDocSnap.exists()) {
        // Append the new notification to the list
        if (customerNotification) {
          await updateDoc(customerNotificationsDocRef, {
            list: arrayUnion(customerNotification),
            xa2: `Cas Expédié (cas #${currentLink.case_id})`,
            xa3: `Nous vous informons que les aligneurs de votre patient ${caseData.patient.first_name} ${caseData.patient.last_name} ont été expédiés,
                            
                            . Vous pouvez suivre l'état de la livraison sur la plateforme Realsmile. Merci,L'équipe Realsmile`,
            xa4: "PUSH",
            xd1: doctorFirestore.Timestamp.now().toMillis(),
          });
        }
      } else {
        console.error("Customer notifications document does not exist.");
      }
    }

    return res.status(200).json({
      message: "Link status updated successfully",
    });
  } catch (error) {
    console.error("Error updating link status:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

function convertBigIntToString(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  }

  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        convertBigIntToString(value),
      ])
    );
  }

  return obj;
}

/* async function generateInvoicePdf(invoice) {
  console.log("Generating invoice PDF for invoice:", invoice);
  invoice.id = parseInt(invoice.id.toString());
  const puppeteerArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
    "--disable-gpu",
  ];

  if (os.platform() === "win32") {
    puppeteerArgs.push("--single-process"); // Specific for Windows
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: puppeteerArgs,
    timeout: 0, // Disable timeout for debugging purposes
  });
  const page = await browser.newPage();

  // Load the invoice HTML from the local server
  const url = `${process.env.SERVER_URL}/invoice-old.html`;
  await page.goto(url, {
    waitUntil: "networkidle0", // Wait until all network requests are idle
  });

  // Convert BigInt values to strings
  const invoiceData = convertBigIntToString(invoice);

  // Determine the doctor's location for footer information
  const doctorCountry = invoice.case?.doctor?.user?.country || "";
  let footerInformation = "contact@realsmile.fr\nTél: + 33 6 25 37 43 82";
  let currency = "€";
  let bankDetails = "";
  let invoiceFromExtra = `
    <h3>Facture de la part de</h3>
    <p>REAL SCAN</p>
    <p>Realsmile</p>
    <p>contact@realsmile.fr</p>
    <p>13 Rue Jean de la Fontaine</p>
    <p>02400 CHATEAU THIERRY</p>
    <p>FRANCE</p>`;

  if (doctorCountry === "TN") {
    footerInformation =
      "contact@realsmile.fr\nTél: + 216 52 044 327 / + 33 6 25 37 43 82";
    currency = "TND";
    bankDetails = `
      <div style="border: 1px solid #ddd; padding: 10px; margin-top: 20px;">
        <h3>Détails bancaires</h3>
        <p>Banque: BIAT</p>
        <p>RIB: 08 063 0210710003747 81</p>
        <p>IBAN: TN59 0806 3021 0710 0037 4781</p>
        <p>BIC: BIATTNTT</p>
      </div>`;
    invoiceFromExtra = `
      <h3>Facture de la part de</h3>
      <p>Real Smile Aligner</p>
      <p>MF: 1820278/B</p>
      <p>E-mail: contact@realsmile.fr</p>`;
  } else if (doctorCountry === "MA") {
    footerInformation = "contact@realsmile.fr\nTél: + 33 6 25 37 43 82";
    currency = "MAD";
    bankDetails = `
      <div style="border: 1px solid #ddd; padding: 10px; margin-top: 20px;">
        <h3>Détails bancaires</h3>
        <p>Banque: CIH BANK</p>
        <p>RIB: 230 780 5622039221032000 33</p>
        <p>IBAN: MA64 2307 8056 2203 9221 0320 0033</p>
        <p>BIC: CIHMMAMC</p>
      </div>`;
    invoiceFromExtra = `
      <h3>Facture de la part de</h3>
      <p>Real Smile Aligner</p>
      <p>N°I.C.E: 003229357000079</p>
      <p>E-mail: contact@realsmile.fr</p>`;
  }

  // Format date
  const formattedDate = new Date(invoice.case.created_at).toLocaleDateString(
    "fr-FR"
  );

  const amountString = `${parseFloat(invoice.amount).toFixed(2)} ${currency}`;

  // Replace placeholders in HTML with actual values
  await page.evaluate(
    (
      invoice,
      footerInformation,
      formattedDate,
      amountString,
      bankDetails,
      invoiceFromExtra
    ) => {
      const doctorUser = invoice.case?.doctor?.user;
      const doctorName = doctorUser
        ? `${doctorUser.first_name} ${doctorUser.last_name}`
        : "Unknown Doctor";
      const doctorEmail = doctorUser?.email || "N/A";
      const doctorOfficePhone = invoice.case?.doctor?.office_phone || "N/A";
      const packName = invoice.case?.packs?.name || "N/A";

      document.body.innerHTML = document.body.innerHTML
        .replace("{{invoiceNumber}}", invoice.invoice_ref)
        .replace("{{invoiceDate}}", formattedDate)
        .replace("{{doctorName}}", doctorName)
        .replace("{{doctorEmail}}", doctorEmail)
        .replace("{{doctorAddress}}", doctorAddress)
        .replace("{{packName}}", packName)
        .replace("{{price1}}", amountString)
        .replace("{{price2}}", amountString)
        .replace("{{totalPrice}}", amountString)
        .replace("{{footerContactInfo}}", footerInformation)
        .replace("{{bankDetails}}", bankDetails)
        .replace("{{invoiceFromExtra}}", invoiceFromExtra);
    },
    invoiceData,
    footerInformation,
    formattedDate,
    amountString,
    bankDetails,
    invoiceFromExtra
  );

  const tempFolder = path.join(__dirname, "..", "temp");
  if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder);
  }

  const pdfFileName = `invoice-${invoice.id.toString()}-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.pdf`;
  const tempPdfPath = path.join(tempFolder, pdfFileName);
  await page.pdf({
    path: tempPdfPath,
    format: "A4",
    printBackground: true,
    margin: {
      top: "1mm",
      bottom: "1mm",
      left: "1mm",
      right: "1mm",
    },
  });
  await browser.close();

  // Read the PDF file content
  const fileContent = fs.readFileSync(tempPdfPath);

  // Upload the PDF file to the CDN
  const pdfUrl = await uploadSingleFile(
    {
      originalname: pdfFileName,
      buffer: fileContent,
      mimetype: "application/pdf",
    },
    invoice.id.toString(),
    process.env.GOOGLE_STORAGE_BUCKET_CASE_PDFS
  );

  // Delete the temporary file
  fs.unlinkSync(tempPdfPath);

  return pdfUrl;
} */

exports.doctorUpdateIIWGLLinkStatus = async (req, res) => {
  const { linkId, status, note } = req.body;
  console.log("Request body:", req.body);

  if (!linkId || !status || !req.user.id) {
    console.log("Missing required fields");
    return res.status(400).json({
      message: "Missing required fields",
    });
  }

  // Check if the status provided is valid
  if (!Object.values(doctorLinkStatusMap).includes(status.toLowerCase())) {
    console.log("Invalid status provided:", status);
    return res.status(400).json({
      message: "Invalid status provided",
    });
  }

  try {
    // Fetch the current link and related case and packs data
    const currentLink = await prisma.labo_links.findUnique({
      where: {
        id: BigInt(linkId),
      },
      include: {
        case: {
          include: {
            packs: true, // Include the related packs in the case
            doctor: {
              include: {
                user: true, // Fetch the associated doctor.user
              },
            },
          },
        },
      },
    });

    // Ensure currentLink exists and is in the correct status
    if (
      !currentLink ||
      currentLink.doctor_validation_status !== generalLinkStatusMap.not_treated
    ) {
      console.log("Link status cannot be changed:", currentLink);
      return res.status(400).json({
        message: "Link status cannot be changed once set",
      });
    }

    // Determine which user ID to use for validation
    let validatedByUserId;
    if (req.user.role === "admin") {
      validatedByUserId = currentLink.case.doctor.user.id; // Updated to use doctor.user.id
    } else if (req.user.role === "doctor") {
      validatedByUserId = parseInt(req.user.id);
    }

    // Prepare the update data
    const updateData = {
      validated_by_doctor: validatedByUserId,
      doctor_validation_status: status.toLowerCase(),
    };

    // Handle rejected status with note
    if (status.toLowerCase() === doctorLinkStatusMap.rejected) {
      updateData.doctor_note = note;
      await prisma.status_histories.create({
        data: {
          name: statusDbEnum.pending,
          case: {
            connect: {
              id: BigInt(currentLink.case_id),
            },
          },
          created_at: new Date(),
        },
      });

      const devisRecord = await prisma.devis.findFirst({
        where: {
          caseId: BigInt(currentLink.case_id),
        },
        select: {
          id: true,
        },
      });

      if (devisRecord) {
        await prisma.devis.update({
          where: {
            id: devisRecord.id,
          },
          data: {
            status: devisDbStatusMap.refused,
          },
        });
      } else {
        console.error(
          "No devis record found for the given caseId:",
          currentLink.case_id
        );
      }
    }

    // Update the link
    const updatedLink = await prisma.labo_links.update({
      where: {
        id: BigInt(linkId),
      },
      data: updateData,
    });

    // Handle accepted status
    if (status.toLowerCase() === doctorLinkStatusMap.accepted) {
      await prisma.status_histories.create({
        data: {
          name: statusDbEnum.in_construction,
          case: {
            connect: {
              id: BigInt(currentLink.case_id),
            },
          },
          created_at: new Date(),
        },
      });

      const caseData = await prisma.cases.findFirst({
        where: {
          id: BigInt(currentLink.case_id),
        },
        include: {
          doctor: {
            include: {
              user: true,
            },
          },
          patient: {
            include: {
              user: true,
            },
          },
        },
      });

      // Prepare email template
      const templatePath = "templates/email/en-fabrication.html";
      const templateData = {
        case_id: parseInt(currentLink.case_id).toString(),
        doctor_name: `${caseData.doctor.user.first_name} ${caseData.doctor.user.last_name}`,
        patient_name: `${caseData.patient.user.first_name} ${caseData.patient.user.last_name}`,
      };

      // Send email to doctor and relevant recipients
      await queueEmail({
        emails: [
          caseData.doctor.user.email,
          "Drkessemtini@realsmile.fr",
          "Realsmile984@gmail.com",
        ],
        subject: `Cas en fabrication (cas #${currentLink.case_id.toString()})`,
        templatePath: templatePath,
        templateData: templateData,
      });

      const devisRecord = await prisma.devis.findFirst({
        where: {
          caseId: BigInt(currentLink.case_id),
        },
        select: {
          id: true,
        },
      });

      if (devisRecord) {
        await prisma.devis.update({
          where: {
            id: devisRecord.id,
          },
          data: {
            status: devisDbStatusMap.accepted,
          },
        });
      } else {
        console.error(
          "No devis record found for the given caseId:",
          currentLink.case_id
        );
      }

      // Create invoice if pack name is not "Finition"
      if (
        currentLink.case.packs &&
        currentLink.case.packs.name !== "Finition"
      ) {
        try {
          const newInvoice = await createInvoice({
            case_id: currentLink.case_id,
            status: invoicesDbStatusMap.pending,
            devis_id: devisRecord?.id,
            amount: null,
            reduction: null,
          });
          const pdfUrl = await generateInvoicePdf(newInvoice);

          await prisma.invoices.update({
            where: {
              id: BigInt(newInvoice.id),
            },
            data: {
              pdf_link: pdfUrl,
            },
          });

          console.log("Invoice created successfully:", newInvoice);
        } catch (invoiceError) {
          console.error("Error creating invoice:", invoiceError);
          return res.status(500).json({
            message: "Error creating invoice",
            error: invoiceError.message,
          });
        }
      }
    }

    return res.status(200).json({
      message: "Link status updated successfully",
    });
  } catch (error) {
    console.error("Error updating link status:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.updateDoctorNote = async (req, res) => {
  const { linkId, note } = req.body;
  if (!linkId || !note) {
    return res.status(400).json({
      message: "Missing required fields",
    });
  }
  try {
    await prisma.labo_links.update({
      where: {
        id: BigInt(linkId),
      },
      data: {
        doctor_note: note,
      },
    });
    return res.status(200).json({
      message: "Link note updated successfully",
    });
  } catch (error) {
    console.error("Error updating link note:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.updateAdminNote = async (req, res) => {
  const { linkId, note } = req.body;
  if (!linkId || !note) {
    return res.status(400).json({
      message: "Missing required fields",
    });
  }
  try {
    await prisma.labo_links.update({
      where: {
        id: BigInt(linkId),
      },
      data: {
        admin_note: note,
      },
    });
    return res.status(200).json({
      message: "Link note updated successfully",
    });
  } catch (error) {
    console.error("Error updating link note:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
