// function extractImages(patientImages) {
//     const images = {};
//     patientImages.forEach((image, index) => {
//         Object.keys(image).forEach(key => {
//             if (key.startsWith('image') && image[key]) {
//                 images[`Image_${key.substring(5)}`] = image[key];
//             }
//         });
//     });
//     return images;
// }

const { extractImagesHandle, uploadSingleFile } = require("./googleCDN");
const { sanitizeCaseDataList } = require("./jsonUtils");
const {
  doctorLinkStatusMap,
  adminLinkStatusMap,
} = require("../enums/iiwglEnum");
const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());

const fs = require("fs");
const path = require("path");
const { default: puppeteer } = require("puppeteer");
const os = require("os");

function extractImages(patientImages, baseUrl) {
  console.log("patientImages :", patientImages);

  const images = {};

  // Ensure patientImages is an array for consistent processing
  if (!Array.isArray(patientImages)) {
    patientImages = [patientImages];
  }

  patientImages.forEach((image, index) => {
    if (image && typeof image === "object") {
      Object.keys(image).forEach((key) => {
        if (key.startsWith("image") && image[key]) {
          // Call extractImagesHandle to process each image URL
          const fullImageUrl = extractImagesHandle([image[key]], baseUrl);
          // Since extractImagesHandle returns an array, take the first element
          images[`Image_${key.substring(5)}`] = fullImageUrl[0];
        }
      });
    }
  });

  console.log("images :", images);
  return images;
}

function extractSingleImage(patientImageUrl, baseUrl) {
  if (!patientImageUrl) return null; // Check if the URL is null or undefined

  // Call extractImagesHandle to process the image URL
  const fullImageUrl = extractImagesHandle([patientImageUrl], baseUrl);
  // Since extractImagesHandle returns an array, take the first element
  return fullImageUrl[0];
}

function extractSTLs(patientSTLs) {
  const stls = []; // Initialize an array for STL files
  if (!patientSTLs) return stls; // Return an empty array if no STL files are found
  // Check and add the first STL file if it exists
  if (patientSTLs.custom_file_1) {
    stls.push({
      id: `STL_${stls.length + 1}`,
      data: patientSTLs.custom_file_1,
    });
  }
  // Check and add the second STL file if it exists
  if (patientSTLs.custom_file_2) {
    stls.push({
      id: `STL_${stls.length + 1}`,
      data: patientSTLs.custom_file_2,
    });
  }
  // Check and add the third STL file if it exists
  if (patientSTLs.custom_file_3) {
    stls.push({
      id: `STL_${stls.length + 1}`,
      data: patientSTLs.custom_file_3,
    });
  }

  // Add base URL prefix to the STL data URLs if they are not already absolute URLs
  const baseUrl = "https://realsmilealigner.com";
  stls.forEach((stl) => {
    if (!stl.data.startsWith("http://") && !stl.data.startsWith("https://")) {
      stl.data = baseUrl + stl.data;
    }
  });

  return stls;
}

function extractPatientLinks(laboLinks) {
  const links = [];
  if (!laboLinks) return links;
  laboLinks.forEach((laboLink) => {
    try {
      const urlRegex = /^https?:\/\//;
      console.log("Testing iiwgl_link:", laboLink.iiwgl_link);
      console.log("Regex test result:", urlRegex.test(laboLink.iiwgl_link));
      if (!laboLink.iiwgl_link) return [];
      if (urlRegex.test(laboLink.iiwgl_link)) {
        console.log("It's a URL, adding directly.");
        links.push({
          url: laboLink.iiwgl_link,
          created_at: laboLink.created_at
            ? laboLink.created_at.toISOString()
            : "N/A",
          status:
            doctorLinkStatusMapTranslatedToFrench[
              laboLink.doctor_validation_status
            ] || "non traité",
          adminStatus:
            doctorLinkStatusMapTranslatedToFrench[
              laboLink.admin_validation_status
            ] || "non traité",
          pdfFile: laboLink.pdf_file || "",
          id: laboLink.id ? laboLink.id.toString() : "Unknown ID",
        });
      } else {
        console.log("Not a URL, parsing as JSON.");
        const linksArray = JSON.parse(laboLink.iiwgl_link);
        const patientLink = linksArray.find((link) => link.type === "patient");
        if (patientLink) {
          links.push({
            url: patientLink.url,
            created_at: laboLink.created_at
              ? laboLink.created_at.toISOString()
              : "N/A",
            status:
              doctorLinkStatusMapTranslatedToFrench[
                laboLink.doctor_validation_status
              ] || "non traité",
            adminStatus:
              doctorLinkStatusMapTranslatedToFrench[
                laboLink.admin_validation_status
              ] || "non traité",
            pdfFile: laboLink.pdf_file || "",
            id: laboLink.id ? laboLink.id.toString() : "Unknown ID",
          });
        }
      }
    } catch (error) {
      console.error("Error extracting or parsing patient link:", error);
    }
  });
  return links;
}

function extractPatientLinksFullInfo(laboLinks) {
  let links = [];
  if (!laboLinks) return links;
  laboLinks.forEach((laboLink) => {
    try {
      // Simplified regex to check if the string starts with http:// or https://
      const urlRegex = /^https?:\/\//;

      console.log("Testing iiwgl_link:", laboLink.iiwgl_link);
      console.log("Regex test result:", urlRegex.test(laboLink.iiwgl_link));

      if (urlRegex.test(laboLink.iiwgl_link)) {
        console.log("It's a URL, adding directly.");
        // If it's a URL, add it directly to the links array
        links.push({
          url: laboLink.iiwgl_link,
          created_at: laboLink.created_at
            ? laboLink.created_at.toISOString()
            : "N/A",
          doctorStatus: doctorLinkStatusMap[laboLink.doctor_validation_status],
          admin_note: laboLink.admin_note || "No note",
          doctor_note: laboLink.doctor_note || "No note",
          adminStatus: adminLinkStatusMap[laboLink.admin_validation_status],
          doctorId: laboLink.validated_by_doctor
            ? laboLink.validated_by_doctor.toString()
            : null,
          adminId: laboLink.validated_by_admin
            ? laboLink.validated_by_admin.toString()
            : null,
          id: laboLink.id.toString(),
        });
      } else {
        console.log("Not a URL, parsing as JSON."); // Debug statement
        // If it's not a URL, assume it's JSON and proceed with existing logic
        const linksArray = JSON.parse(laboLink.iiwgl_link);
        const patientLink = linksArray.find((link) => link.type === "patient");
        if (patientLink) {
          links.push({
            url: patientLink.url,
            created_at: laboLink.created_at
              ? laboLink.created_at.toISOString()
              : "N/A",
            doctorStatus:
              doctorLinkStatusMap[laboLink.doctor_validation_status],
            adminStatus: adminLinkStatusMap[laboLink.admin_validation_status],
            doctorId: laboLink.validated_by_doctor
              ? laboLink.validated_by_doctor.toString()
              : null,
            adminId: laboLink.validated_by_admin
              ? laboLink.validated_by_admin.toString()
              : null,
            id: laboLink.id.toString(),
            admin_note: laboLink.admin_note || "No note",
            doctor_note: laboLink.doctor_note || "No note",
            pdfFile: laboLink.pdf_file ? laboLink.pdf_file : "pas de pdf file",
          });
        }
      }
    } catch (error) {
      console.error("Error extracting patient link:", error);
    }
  });

  return links;
}

const default_case_data = {
  Overjet: null, // Overjet as discussed, usually in mm
  taquets: null, // This needs clear mapping, might correspond to `tacksNeeded`
  Overbite: null, // Typically relates to supraclusion (deep bite)
  surplomb: null, // This could be another term for overjet or overbite
  deep_bite: null, // Directly relates to supraclusion
  droite_canine: null, // Right canine relationship (CI, CII, CIII)
  gauche_canine: null, // Left canine relationship
  lower_midline: null, // Could be 'moveInferieur'
  sens_sagittal: null, // Sagittal sense or corrections needed
  sens_vertical: null, // Vertical sense or corrections needed
  upper_midline: null, // Could be 'moveSuperieur'
  anterior_teeth: null, // May require definition or could be related to orthodontic movements or aesthetics
  arch_selection: null, // Selection between maxillary, mandibular, or both
  droite_molaire: null, // Right molar relationship
  gauche_molaire: null, // Left molar relationship
  ipr_lower_arch: null, // Interproximal reduction in the lower arch
  ipr_upper_arch: null, // Interproximal reduction in the upper arch
  upper_midline2: null, // If distinct from 'upper_midline', need specific usage
  corriger_beance: null, // Specific to correcting open bite
  espace_residuel: null, // Management of residual spaces for missing teeth
  correction_cl_II: null, // Options for Class II correction
  sens_transversal: null, // Transversal sense or corrections needed
  beance_correction: null, // Detailed settings or methods for open bite correction
  correction_cl_III: null, // Options for Class III correction
  posterior_crossbite: null, // Could be related to correction options for crossbite
  dents_extraire_cl_II: null, // Specific teeth to be extracted for Class II correction
  espace_residuel_text: null, // Textual detail for managing residual spaces
  expansion_lower_arch: null, // Lower arch expansion requirements
  expansion_upper_arch: null, // Upper arch expansion requirements
  corriger_supraclusion: null, // Direct actions to correct overbite
  dents_extraire_cl_III: null, // Specific teeth to be extracted for Class III correction
  instructions_generales: null, // General instructions for the case
  milieur_inter_incisifs: null, // Inter-incisive midline evaluation or correction
  molar_relationship_left: null, // Left molar relationship (CI, CII, CIII)
  proclination_lower_arch: null, // Lower arch proclination adjustments
  proclination_upper_arch: null, // Upper arch proclination adjustments
  supraclusion_correction: null, // Specific methods or details for supraclusion correction
  treatment_specification: null, // Detailed specifications or preferences for treatment
  canine_relationship_left: null, // Left canine relationship (CI, CII, CIII)
  molar_relationship_right: null, // Right molar relationship (CI, CII, CIII)
  canine_relationship_right: null, // Right canine relationship (CI, CII, CIII)
  deplacer_milieu_inferieur: null, // Decision to move the lower midline left/right
  deplacer_milieur_superieur: null, // Decision to move the upper midline left/right
  ne_pas_placer_taquets_text: null, // Specific teeth not to place tacks on
  expansion_necessaire_maintenir: null, // Decision to maintain necessary expansion
  inversion_articulee_posterieure: null, // Specific posterior articulated inversion (if any)
  expansion_necessaire_maxillaire: null, // Necessity for maxillary expansion
  expansion_necessaire_mandibulaire: null, // Necessity for mandibular expansion
};

const generatePdfForCase = async (caseData, caseId, htmlTemplate) => {
  const tempFolder = path.join(__dirname, "templates", caseId.toString());
  const pdfFileName = `${caseId}.pdf`;
  const pdfFilePath = path.join(tempFolder, pdfFileName);

  try {
    if (!fs.existsSync(tempFolder)) {
      fs.mkdirSync(tempFolder, { recursive: true });
    }
  } catch (err) {
    console.error("Error creating temp folder:", err);
    throw new Error("Error creating temp folder");
  }

  const { patient, caseData: caseDataContent } = caseData;

  // Create a mapping for French labels and values
  const fieldLabels = {
    overjet: "Surplomb horizontal",
    molarLeft: "Molaire gauche",
    canineLeft: "Canine gauche",
    molarRight: "Molaire droite",
    canineRight: "Canine droite",
    tacksNeeded: "Plaque nécessaire",
    sensVertical: "Sens vertical",
    moveInferieur: "Déplacement inférieur",
    moveSuperieur: "Déplacement supérieur",
    specificTeeth: "Dents spécifiques",
    teethToReplace: "Dents à remplacer",
    posteriorOption: "Option postérieure",
    sensTransversal: "Sens transversal",
    selectionArcades: "Sélection des arcades",
    teethToExtractCL2: "Dents à extraire Classe II",
    teethToExtractCL3: "Dents à extraire Classe III",
    diastemaManagement: "Gestion des diastèmes",
    optionsMaxillaires: "Options maxillaires",
    sagittalCorrection: "Correction sagittale",
    generalInstructions: "Instructions générales",
    correctionOptionsCI2: "Options de correction CI2",
    correctionOptionsCI3: "Options de correction CI3",
    optionsMandibulaires: "Options mandibulaires",
    zoneCorrectionBeance: "Zone de correction de béance",
    encroachmentMaxillary: "Intrusion maxillaire",
    interIncisivePosition: "Position inter-incisive",
    orthodonticProcedures: "Procédures orthodontiques",
    actionAnomalieVertical: "Action anomalie verticale",
    encroachmentMandibular: "Intrusion mandibulaire",
    actionAnomaliePosterior: "Action anomalie postérieure",
    residualSpaceManagement: "Gestion de l'espace résiduel",
    sagittalExpansionMaxillary: "Expansion sagittale maxillaire",
    zoneCorrectionSupraclusion: "Zone de correction de la supraclusion",
    sagittalExpansionMandibular: "Expansion sagittale mandibulaire",
    transversalExpansionMaxillary: "Expansion transversale maxillaire",
    transversalExpansionMandibular: "Expansion transversale mandibulaire",
    interproximalReductionMaxillary: "Réduction interproximale maxillaire",
    interproximalReductionMandibular: "Réduction interproximale mandibulaire",
  };

  const fieldValues = {
    améliorerStripping: "Améliorer stripping",
    CLIII: "Classe III",
    CLII: "Classe II",
    CLI: "Classe I",
    nePasPlacer: "Ne pas placer",
    supraclusion: "Supraclusion",
    "Vers la droite": "Vers la droite",
    "Vers la gauche": "Vers la gauche",
    endoalveolie: "Endoalvéolie",
    mandibulaire: "Mandibulaire",
    lesDeux: "Les deux",
    fermer: "Fermer",
    maintenir: "Maintenir",
    ouvrir: "Ouvrir",
    expansion: "Expansion",
    elasticsCII: "Élastiques Classe II",
    strippingMandibulaire: "Stripping mandibulaire",
    chirurgieOrthognathique: "Chirurgie orthognathique",
    extractions: "Extractions",
    elasticsCIII: "Élastiques Classe III",
    non: "Non",
    oui: "Oui",
    siNecessary: "Si nécessaire",
    posteriorEgression: "Égression postérieure",
    retroIncisiveOcclusalRamps: "Rampes occlusales rétro-incisives",
    anteriorIngression: "Ingression antérieure",
    inversionPostérieure: "Inversion postérieure",
    deplacerMilieu: "Déplacer le milieu",
    maxillaryAndMandibularContraction: "Contraction maxillaire et mandibulaire",
    correct: "Corriger",
  };

  // Function to format date in French
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  };

  // Create rows for the table using French labels and values
  let caseDataRows = "";
  for (const [key, value] of Object.entries(caseDataContent)) {
    if (
      fieldLabels[key] &&
      value !== null &&
      value !== "" &&
      value.length !== 0
    ) {
      const displayValue = Array.isArray(value)
        ? value.map((v) => fieldValues[v] || v).join(", ")
        : fieldValues[value] || value;
      caseDataRows += `
                <tr>
                    <th style="width: 50%">${fieldLabels[key]}</th>
                    <td style="width: 50%">${displayValue}</td>
                </tr>`;
    }
  }

  let html = htmlTemplate
    .replace("{{caseId}}", caseId)
    .replace("{{firstName}}", patient.first_name)
    .replace("{{lastName}}", patient.last_name)
    .replace("{{gender}}", patient.gender)
    .replace("{{dateOfBirth}}", formatDate(patient.date_of_birth))
    .replace("{{caseDataRows}}", caseDataRows);

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

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: puppeteerArgs,
      timeout: 0, // Disable timeout for debugging purposes
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 0 });
    await page.pdf({
      path: pdfFilePath,
      format: "A3",
      printBackground: true,
      margin: {
        top: "10mm",
        bottom: "10mm",
        left: "10mm",
        right: "10mm",
      },
    });

    await browser.close();

    const fileContent = await fs.promises.readFile(pdfFilePath);

    const imageUrl = await uploadSingleFile(
      {
        originalname: pdfFileName,
        buffer: fileContent,
        mimetype: "application/pdf",
      },
      caseId,
      process.env.GOOGLE_STORAGE_BUCKET_CASE_PDFS
    );

    const updatedCase = await prisma.cases.update({
      where: { id: BigInt(caseId) },
      data: {
        pdf_link: imageUrl,
      },
    });

    return imageUrl;
  } catch (error) {
    console.error("Error generating PDF:", error);
    throw new Error("Error generating PDF");
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

async function generateInvoicePdf(invoice) {
  invoice.id = parseInt(invoice.id.toString());

  const puppeteerArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--no-zygote",
  ];

  if (process.platform === "win32") {
    puppeteerArgs.push(
      "--disable-gpu",
      "--single-process",
      "--proxy-server='direct://'",
      "--proxy-bypass-list=*"
    );
    process.env.CHROME_PATH =
      process.env.CHROME_PATH ||
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";
  } else {
    puppeteerArgs.push("--disable-gpu");
  }

  let tempPdfPath = null;
  let pdfFileName = null;
  let browser = null;

  try {
    const browserConfig = {
      headless: "new",
      args: puppeteerArgs,
      timeout: 60000,
      ...(process.platform === "win32" && {
        executablePath: process.env.CHROME_PATH,
      }),
    };

    browser = await puppeteer.launch(browserConfig);
    const page = await browser.newPage();

    const isLocalhost = process.env.NODE_ENV === "development";
    let url = `${process.env.SERVER_URL}/invoice-old.html`;

    if (isLocalhost && process.platform === "win32") {
      const templatePath = path.join(
        __dirname,
        "..",
        "templates",
        "invoice-old.html"
      );
      url = `file://${templatePath.replace(/\\/g, "/")}`;
    }

    await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    const invoiceData = convertBigIntToString(invoice);
    const doctorCountry = invoice.case?.doctor?.user?.country || "";

    // TIMBRE FISCAL LOGIC
    let productAmount = parseFloat(invoice.amount);
    const totalAmount = parseFloat(invoice.amount); // Keep original total
    // Format amounts
    const currency =
      doctorCountry === "TN" ? "TND" : doctorCountry === "MA" ? "MAD" : "€";

    if (doctorCountry === "TN") {
      productAmount -= 1;
    }
    const productPriceString = `${productAmount.toFixed(2)} ${currency}`;
    const totalPriceString = `${totalAmount.toFixed(2)} ${currency}`;
    const packName = invoice.case?.packs?.name || "N/A";

    // Rest of the country-specific configuration
    let footerInformation = "contact@realsmile.fr\nTél: + 33 6 25 37 43 82";
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
      bankDetails = `
      <div class="bank-details">
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
      bankDetails = `
      <div class="bank-details">
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

    const formattedDate = new Date(invoice.created_at).toLocaleDateString(
      "fr-FR"
    );
    const doctorUser = invoice.case?.doctor?.user;
    const doctorName = doctorUser
      ? `${doctorUser.first_name} ${doctorUser.last_name}`
      : "Unknown Doctor";
    const doctorEmail = doctorUser?.email || "N/A";
    const doctorOfficePhone = invoice.case?.doctor?.office_phone || "N/A";
    const doctorAddress = `${invoice.case?.doctor?.address || "N/A"}, ${
      doctorUser?.phone || "N/A"
    }`;

    await page.evaluate(
      (data) => {
        document.body.innerHTML = document.body.innerHTML
          .replace("{{invoiceNumber}}", data.invoice_ref)
          .replace("{{invoiceDate}}", data.formattedDate)
          .replace("{{caseId}}", data.caseId)
          .replace("{{doctorName}}", data.doctorName)
          .replace("{{doctorEmail}}", data.doctorEmail)
          .replace("{{doctorAddress}}", data.doctorAddress)
          .replace("{{packName}}", data.packName)
          .replace("{{price1}}", data.productPriceString)
          .replace("{{price2}}", data.productPriceString)
          .replace("{{totalPrice}}", data.totalPriceString)
          .replace("{{footerContactInfo}}", data.footerInformation)
          .replace("{{bankDetails}}", data.bankDetails)
          .replace("{{invoiceFromExtra}}", data.invoiceFromExtra);

        if (data.doctorCountry !== "TN") {
          const timbreRows = document.querySelectorAll(".timbre-fiscal");
          timbreRows.forEach((row) => row.remove());
        }
      },
      {
        ...invoiceData,
        formattedDate,
        doctorName,
        doctorEmail,
        doctorAddress,
        packName,
        productPriceString,
        totalPriceString,
        footerInformation,
        bankDetails,
        invoiceFromExtra,
        caseId: invoice.case?.id?.toString() || "N/A",
        doctorCountry,
      }
    );

    const tempFolder = path.join(__dirname, "..", "temp");
    if (!fs.existsSync(tempFolder)) {
      fs.mkdirSync(tempFolder, { recursive: true });
    }

    const safeInvoiceId = invoice.id.toString().replace(/[^a-z0-9]/gi, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    pdfFileName = `invoice-${safeInvoiceId}-${timestamp}.pdf`;
    tempPdfPath = path.join(tempFolder, pdfFileName);
    tempPdfPath = path.normalize(tempPdfPath);

    await page.pdf({
      path: tempPdfPath,
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        bottom: "10mm",
        left: "10mm",
        right: "10mm",
      },
    });
  } catch (error) {
    console.error("PDF Generation Error:", {
      message: error.message,
      stack: error.stack,
      platform: process.platform,
      env: process.env.NODE_ENV,
      chromePath: process.env.CHROME_PATH,
    });
    throw error;
  } finally {
    if (browser) {
      await browser
        .close()
        .catch((err) => console.error("Browser close error:", err));
    }
  }

  try {
    // Read PDF with retry logic for Windows file locking issues
    let fileContent;
    let retries = 3;
    while (retries > 0) {
      try {
        fileContent = fs.readFileSync(tempPdfPath);
        break;
      } catch (readError) {
        retries--;
        if (retries === 0) throw readError;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Upload to Google Storage
    const pdfUrl = await uploadSingleFile(
      {
        originalname: pdfFileName,
        buffer: fileContent,
        mimetype: "application/pdf",
      },
      invoice.id.toString(),
      process.env.GOOGLE_STORAGE_BUCKET_CASE_PDFS
    );

    // Windows-safe file deletion
    if (fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
    }

    return pdfUrl;
  } catch (error) {
    console.error("Post-Generation Error:", {
      message: error.message,
      stack: error.stack,
      tempPath: tempPdfPath,
    });
    throw error;
  }
}

module.exports = {
  extractImages: extractImages,
  extractSTLs: extractSTLs,
  extractPatientLinks: extractPatientLinks,
  default_case_data: default_case_data,
  extractPatientLinksFullInfo: extractPatientLinksFullInfo,
  extractSingleImage: extractSingleImage,
  generatePdfForCase: generatePdfForCase,
  generateInvoicePdf: generateInvoicePdf,
};
