const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());
const fetch = require("node-fetch");
const {
  extractImagesHandle,
  extractStlsHandle,
  uploadSingleFile,
  uploadBinaryFile,
  uploadSingleFileReadable,
} = require("../utils/googleCDN");
const {
  extractPatientLinksFullInfo,
  extractSingleImage,
} = require("../utils/caseUtils");
const {
  differenceInHours,
  addHours,
  formatDistanceToNow,
  differenceInSeconds,
  addSeconds,
} = require("date-fns");
const { adminLinkStatusMap, dbLinkStatusMap } = require("../enums/iiwglEnum");
const { statusDbEnum } = require("../enums/caseEnum");
const multer = require("multer");
const sendEmail = require("../utils/email");
const admin = require("firebase-admin");
const baseUrl = "https://realsmilealigner.com";
const patient_image_url = "https://realsmilealigner.com/uploads/thumbnail/";
const upload = multer({ storage: multer.memoryStorage() });
const cpUpload = upload.fields([{ name: "pdf", maxCount: 1 }]);
const {
  doc,
  updateDoc,
  setDoc,
  arrayUnion,
  getDoc,
} = require("firebase/firestore");
const { doctorFirestore, db } = require("../utils/firebaseConfig");
const queueEmail = require("../utils/email");

async function getFileSize(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (response.ok) {
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        // Convert content length to MB and round to two decimal places
        const fileSizeMB = (parseInt(contentLength) / (1024 * 1024)).toFixed(2);
        return `${fileSizeMB}MB`;
      } else {
        return "Unknown";
      }
    } else {
      throw new Error(`Failed to fetch file size: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error fetching file size:", error);
    throw error;
  }
}

function ensureFullUrl(url) {
  if (!url?.startsWith("http://") && !url?.startsWith("https://")) {
    return `https://realsmilealigner.com${url}`;
  }
  return url;
}

exports.getCaseDetailsWithSTLsAndImages = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ message: "Invalid case ID provided" });
    }

    const caseData = await prisma.cases.findUnique({
      where: { id: BigInt(id) },
      include: {
        patient_stls: true,
        patient_images: true,
        status_histories: {
          orderBy: { created_at: "desc" },
          take: 1, // Take the most recent status
          select: {
            name: true,
            created_at: true,
          },
        },
        labo_links: {
          orderBy: { created_at: "desc" },
          take: 1, // Take the most recent lab link
          select: {
            admin_validation_status: true,
            created_at: true,
          },
        },
      },
    });

    if (!caseData) {
      return res.status(404).json({ message: "Case not found" });
    }

    const latestStatus = caseData.status_histories[0];
    const latestLabLink =
      caseData.labo_links.length > 0 ? caseData.labo_links[0] : null;

    if (latestStatus) {
      const latestStatusCreatedAtString = latestStatus.created_at;
      const latestStatusCreatedAt = new Date(latestStatusCreatedAtString);

      if (isNaN(latestStatusCreatedAt.getTime())) {
        console.error("Invalid date format:", latestStatusCreatedAtString);
      }

      const currentTime = new Date();
      const secondsDifference = differenceInSeconds(
        currentTime,
        latestStatusCreatedAt
      );
      const thresholdSeconds = 86400; // 24 hours in seconds

      const isPendingAndUnvalidated =
        latestStatus.name === statusDbEnum.pending &&
        (!latestLabLink ||
          latestLabLink.admin_validation_status ===
            adminLinkStatusMap.not_treated);

      const isLate =
        latestStatus.name === statusDbEnum.pending &&
        (!latestLabLink ||
          latestLabLink.admin_validation_status ===
            adminLinkStatusMap.not_treated) &&
        secondsDifference >= thresholdSeconds;

      const lateTime = isLate
        ? Math.max(0, secondsDifference - thresholdSeconds)
        : null;
      const remainingTime =
        !isLate && latestStatus.name === statusDbEnum.pending
          ? differenceInSeconds(
              addSeconds(latestStatusCreatedAt, thresholdSeconds),
              currentTime
            )
          : null;

      // Extract images and STL files and ensure full URLs
      const imageUrls = Array.from({ length: 10 }, (_, i) =>
        ensureFullUrl(caseData.patient_images?.[`image${i + 1}`])
      ).filter(Boolean);

      const stlUrls = Array.from({ length: 3 }, (_, i) =>
        ensureFullUrl(caseData.patient_stls?.[`custom_file_${i + 1}`])
      ).filter(Boolean);

      // Process images and STL files to retrieve additional data
      const imagesData = await Promise.all(
        imageUrls.map(async (url, index) => {
          try {
            const fileSize = await getFileSize(url);
            return {
              id: `${id}_${index}`,
              file: {
                name: url.split("/").pop() || `Image_${index + 1}`,
                avatar: "",
                url,
              },
              size: fileSize,
              type: "Image",
              modified: new Date().toISOString(),
            };
          } catch (error) {
            console.error("Error fetching file size for", url, error);
            return {
              id: `${id}_${index}`,
              file: {
                name: `Image ${index + 1}`,
                avatar: "",
                url: "", // Provide a default URL or leave it empty
              },
              size: "Unknown",
              type: "",
              modified: new Date().toISOString(),
            };
          }
        })
      );

      const stlData = await Promise.all(
        stlUrls.map(async (url, index) => {
          try {
            const fileSize = await getFileSize(url);
            return {
              id: `${id}_stl_${index}`,
              file: {
                name: url.split("/").pop() || `STL_${index + 1}`,
                avatar: "",
                url,
              },
              size: fileSize,
              type: "STL",
              modified: new Date().toISOString(),
            };
          } catch (error) {
            console.error("Error fetching file size for", url, error);
            return {
              id: `${id}_stl_${index}`,
              file: {
                name: `STL ${index + 1}`,
                avatar: "",
                url: "", // Provide a default URL or leave it empty
              },
              size: "Unknown",
              type: "",
              modified: new Date().toISOString(),
            };
          }
        })
      );

      let pdfData = [];
      if (caseData.pdf_link) {
        const pdfUrl = ensureFullUrl(caseData.pdf_link);
        const pdfFileSize = await getFileSize(pdfUrl);
        pdfDataInit = {
          id: `${id}_pdf`,
          file: {
            name: pdfUrl.split("/").pop() || `PDF`,
            avatar: "",
            url: pdfUrl,
          },
          size: pdfFileSize,
          type: "PDF",
          modified: new Date().toISOString(),
        };
        pdfData.push(pdfDataInit);
      }

      // Construct the response
      const responseData = {
        images: imagesData,
        stls: stlData,
        pdf: pdfData,
        isLate,
        lateTime,
        remainingTime,
        require_smile_set_upload: isPendingAndUnvalidated
          ? "Missing link"
          : "Done",
      };

      return res.status(200).json(responseData);
    }
  } catch (error) {
    console.error("Error retrieving case details:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getLaboCaseIiwgl = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ message: "Invalid case ID provided" });
    }

    const caseData = await prisma.cases.findUnique({
      where: { id: BigInt(id) },
      include: {
        labo_links: {
          orderBy: {
            created_at: "desc", // Order lab links by created_at in descending order
          },
        },
      },
    });

    if (!caseData) {
      return res.status(404).json({ message: "Case not found" });
    }

    const links = extractPatientLinksFullInfo(caseData.labo_links || []);
    const responseData = {
      links: links,
    };

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Error retrieving case details:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// exports.addIiwglLink = async (req, res) => {
//     cpUpload(req, res, async (error) => {
//         const { user: reqUser, body, files } = req;
//         const { caseId, iiwglLink ,packId } = body;
//         console.log("reqUser:", body);
//         const pdfFile = files?.pdf ? files.pdf[0] : null;
//         console.log("pdfFile:", pdfFile);
//
//         // Validate caseId
//         if (!caseId || isNaN(Number(caseId))) {
//             return res.status(400).json({ message: "Invalid case ID provided" });
//         }
//
//         // Check for existing links for the case
//         const caseIiwgls = await prisma.labo_links.findMany({
//             where: { case_id: BigInt(caseId) },
//             orderBy: { created_at: 'desc' },
//         });
//
//         // Check for duplicate link and validation status
//         let adminStatus = "not_treated";
//         let adminId = null;
//         if (caseIiwgls.length > 0) {
//             const lastIiwgl = caseIiwgls[0];
//
//             if (
//                 lastIiwgl.admin_validation_status === dbLinkStatusMap.not_treated ||
//                 (lastIiwgl.admin_validation_status === dbLinkStatusMap.accepted &&
//                     lastIiwgl.doctor_validation_status === dbLinkStatusMap.not_treated)
//             ) {
//                 return res.status(409).json({ message: "Previous IIWGL link not yet validated" });
//             }
//
//             const existingLink = caseIiwgls.find((link) => link.iiwgl_link === iiwglLink);
//             if (existingLink) {
//                 return res.status(409).json({ message: "IIWGL link already exists" });
//             }
//         }
//
//         // Set admin validation status if the user is an admin
//         if (reqUser.role === "admin") {
//             adminStatus = dbLinkStatusMap.accepted;
//             adminId = reqUser.id;
//         }
//
//         // Save the PDF file if it exists
//         if (pdfFile) {
//             const pdfUrl = await uploadSingleFileReadable (
//                 pdfFile,
//                 caseId,
//                 process.env.GOOGLE_STORAGE_BUCKET_PDF_FILES,
//             );
//             // Attempt to create a new labo_link in the database
//             try {
//                 const newLink = await prisma.labo_links.create({
//                     data: {
//                         case_id: parseInt(caseId),
//                         iiwgl_link: iiwglLink,
//                         admin_validation_status: adminStatus,
//                         doctor_validation_status: dbLinkStatusMap.not_treated,
//                         validated_by_admin: adminId,
//                         validated_by_doctor: null,
//                         pdf_file: pdfUrl,
//                     },
//                 });
//
//                 if (reqUser.role === "admin") {
//                     await prisma.status_histories.create({
//                         data: {
//                             name: "needs_approval",
//                             created_at: new Date(),
//                             case: {
//                                 connect: {
//                                     id: BigInt(caseId),
//                                 },
//                             },
//                         },
//                     });
//
//                     // Fetch the case to get patient details
//                     const caseData = await prisma.cases.findUnique({
//                         where: { id: BigInt(caseId) },
//                         select: {
//                             patient: {
//                                 select: {
//                                     first_name: true,
//                                     last_name: true,
//                                 }
//                             },
//                             doctor: {
//                                 select: {
//                                     user: {
//                                         select: {
//                                             email: true,
//                                             id : true
//                                         }
//                                     }
//                                 }
//                             }
//                         }
//                     });
//                     if (!caseData) {
//                         throw new Error("Case not found");
//                     }
//
//                     const patientName = `${caseData.patient.first_name} ${caseData.patient.last_name}`;
//                     const doctorEmail = caseData.doctor.user.email;
//
//                     const templatePath = 'templates/email/needs-approval.html'; // Provide the path to your HTML template
//                     const templateData = {
//                         caseUrl: process.env.CLIENT_URL + "/cases/" + caseId,
//                         patientName: patientName, // Add patient name
//                     };
//
//                     await sendEmail({
//                         email: doctorEmail,
//                         subject: `Approbation requise (cas #${caseId.toString()})`,
//                         templatePath: templatePath,
//                         templateData: templateData
//                     });
//
//                     const customerNotification = {
//                         xa1: caseData.doctor.user.id.toString(),
//                         xa2: "Nouveau lien IIWGL",
//                         xa3: `Un nouveau lien IIWGL a été ajouté à votre cas et nécessite une approbation.`,
//                         xa5: "",
//                         xa9: doctorEmail,
//                         xd1: doctorFirestore.Timestamp.now().toMillis(),
//                         xf4: false,
//                     };
//
//                     const agentNotification = {
//                         xa1: caseData.doctor.user.id.toString(),
//                         xa2: "Nouveau lien IIWGL ajouté",
//                         xa3: `Un nouveau lien IIWGL a été ajouté pour le cas du docteur ${caseData.doctor.user.first_name} ${caseData.doctor.user.last_name} et nécessite une approbation.`,
//                         xa5: "",
//                         xa9: doctorEmail,
//                         xd1: doctorFirestore.Timestamp.now().toMillis(),
//                         xf4: false,
//                     };
//
//                     // Reference to the customer's customernotifications document
//                     const customerNotificationsDocRef = doc(db, "customers", caseData.doctor.user.id.toString(), "customernotifications", "customernotifications");
//                     // Reference to the agent's agentnotifications document
//                     const agentNotificationsDocRef = doc(db, "userapp", "agentnotifications");
//
//                     // Check if the customer notifications document exists
//                     const customerDocSnapshot = await getDoc(customerNotificationsDocRef);
//                     if (customerDocSnapshot.exists()) {
//                         // Append the new notifications to the customer's list
//                         await setDoc(customerNotificationsDocRef, {
//                             list: arrayUnion(customerNotification)
//                         }, { merge: true }); // Use merge to update only the specified fields
//                     }
//
//                     // Check if the agent notifications document exists
//                     const agentDocSnapshot = await getDoc(agentNotificationsDocRef);
//                     if (agentDocSnapshot.exists()) {
//                         // Append the new notifications to the agent's list
//                         await setDoc(agentNotificationsDocRef, {
//                             list: arrayUnion(agentNotification)
//                         }, { merge: true }); // Use merge to update only the specified fields
//                     }
//                 }
//
//                 return res.status(201).json({ message: "IIWGL link added successfully" });
//             } catch (error) {
//                 console.error("Error adding IIWGL link: ", error);
//                 return res.status(500).json({ message: "Internal server error" });
//             }
//         } else {
//             return res.status(400).json({ message: "PDF file is required" });
//         }
//     });
// };

exports.addIiwglLink = async (req, res) => {
  cpUpload(req, res, async (error) => {
    const { user: reqUser, body, files } = req;
    const { caseId, iiwglLink, packId, reduction } = body;
    console.log("reqUser:", body);
    const pdfFile = files?.pdf ? files.pdf[0] : null;
    console.log("pdfFile:", pdfFile);

    // Validate caseId
    if (!caseId || isNaN(Number(caseId))) {
      return res.status(400).json({ message: "Invalid case ID provided" });
    }

    // Check for existing links for the case
    const caseIiwgls = await prisma.labo_links.findMany({
      where: { case_id: BigInt(caseId) },
      orderBy: { created_at: "desc" },
    });

    // Check for duplicate link and validation status
    let adminStatus = "not_treated";
    let adminId = null;
    /* if (caseIiwgls.length > 0) {
      const lastIiwgl = caseIiwgls[0];

      if (
        lastIiwgl.admin_validation_status === dbLinkStatusMap.not_treated ||
        (lastIiwgl.admin_validation_status === dbLinkStatusMap.accepted &&
          lastIiwgl.doctor_validation_status === dbLinkStatusMap.not_treated)
      ) {
        return res
          .status(409)
          .json({ message: "Previous IIWGL link not yet validated" });
      }
    } */

    // Set admin validation status if the user is an admin
    if (reqUser.role === "admin") {
      adminStatus = dbLinkStatusMap.accepted;
      adminId = reqUser.id;
    }

    // Save the PDF file if it exists
    if (pdfFile) {
      const pdfUrl = await uploadSingleFileReadable(
        pdfFile,
        caseId,
        process.env.GOOGLE_STORAGE_BUCKET_PDF_FILES
      );
      // Attempt to create a new labo_link in the database
      try {
        const newLink = await prisma.labo_links.create({
          data: {
            case_id: BigInt(parseInt(caseId)),
            iiwgl_link: iiwglLink,
            admin_validation_status: adminStatus,
            doctor_validation_status: dbLinkStatusMap.not_treated,
            validated_by_admin: adminId,
            validated_by_doctor: null,
            pdf_file: pdfUrl,
          },
        });

        if (reqUser.role === "admin") {
          await prisma.status_histories.create({
            data: {
              name: "needs_approval",
              created_at: new Date(),
              case: {
                connect: {
                  id: BigInt(caseId),
                },
              },
            },
          });

          const pack = await prisma.packs.findUnique({
            where: {
              id: BigInt(packId), // Corrected to BigInt
            },
          });

          await prisma.cases.update({
            where: {
              id: BigInt(parseInt(caseId)),
            },
            data: {
              packs: {
                connect: {
                  id: BigInt(pack.id),
                },
              },
            },
          });

          // Fetch the case to get patient details
          const caseData = await prisma.cases.findUnique({
            where: { id: BigInt(caseId) },
            select: {
              patient: {
                select: {
                  first_name: true,
                  last_name: true,
                },
              },
              doctor: {
                select: {
                  user: {
                    select: {
                      email: true,
                      id: true,
                      country: true,
                    },
                  },
                },
              },
            },
          });
          if (!caseData) {
            throw new Error("Case not found");
          }

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
              caseId: BigInt(parseInt(caseId)),
              price: price.toString(),
              reduction: parseInt(reduction) ? parseInt(reduction) : 0,
              created_at: new Date(),
              due_date: new Date(new Date().setDate(new Date().getDate() + 7)), // corrected spelling
            },
          });

          const patientName = `${caseData.patient.first_name} ${caseData.patient.last_name}`;
          const doctorEmail = caseData.doctor.user.email;

          const templatePath = "templates/email/needs-approval.html"; // Provide the path to your HTML template
          const templateData = {
            caseUrl: process.env.CLIENT_URL + "/cases/" + caseId,
            patientName: patientName, // Add patient name
          };

          await queueEmail({
            emails: [doctorEmail],
            subject: `Approbation requise (cas #${caseId.toString()})`,
            templatePath: templatePath,
            templateData: templateData,
          });

          const customerNotification = {
            xa1: caseData.doctor.user.id.toString(),
            xa2: "Approbation requise (cas #${caseId.toString()})",
            xa3: `Un nouveau lien IIWGL a été ajouté à votre cas et nécessite une approbation.`,
            xa5: "",
            xa9: doctorEmail,
            xd1: doctorFirestore.Timestamp.now().toMillis(),
            xf4: false,
          };

          const agentNotification = {
            xa1: caseData.doctor.user.id.toString(),
            xa2: "Approbation requise (cas #${caseId.toString()})",
            xa3: `Un nouveau lien IIWGL a été ajouté pour le cas du docteur ${caseData.doctor.user.first_name} ${caseData.doctor.user.last_name} et nécessite une approbation.`,
            xa5: "",
            xa9: doctorEmail,
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
          // Reference to the agent's agentnotifications document
          const agentNotificationsDocRef = doc(
            db,
            "userapp",
            "agentnotifications"
          );

          // Check if the customer notifications document exists
          const customerDocSnapshot = await getDoc(customerNotificationsDocRef);
          if (customerDocSnapshot.exists()) {
            // Append the new notifications to the customer's list
            await setDoc(
              customerNotificationsDocRef,
              {
                list: arrayUnion(customerNotification),
              },
              { merge: true }
            ); // Use merge to update only the specified fields
          }

          // Check if the agent notifications document exists
          const agentDocSnapshot = await getDoc(agentNotificationsDocRef);
          if (agentDocSnapshot.exists()) {
            // Append the new notifications to the agent's list
            await setDoc(
              agentNotificationsDocRef,
              {
                list: arrayUnion(agentNotification),
              },
              { merge: true }
            ); // Use merge to update only the specified fields
          }
        } else if (reqUser.role === "labo") {
          const caseData = await prisma.cases.findUnique({
            where: { id: BigInt(caseId) },
            select: {
              doctor: {
                select: {
                  user: {
                    select: {
                      email: true,
                      id: true,
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

          const templatePath = "templates/email/iiwgl-link.html"; // Provide the path to your HTML template
          const templateData = {
            patientName: `${caseData.patient.first_name} ${caseData.patient.last_name}`,
          };

          await queueEmail({
            emails: ["Drkessemtini@realsmile.fr"],
            subject: `Nouveau lien IIWGL (cas #${caseId.toString()})`,
            templatePath: templatePath,
            templateData: templateData,
          });
        }

        return res
          .status(201)
          .json({ message: "IIWGL link added successfully" });
      } catch (error) {
        console.error("Error adding IIWGL link: ", error);
        return res.status(500).json({ message: "Internal server error" });
      }
    } else {
      return res.status(400).json({ message: "PDF file is required" });
    }
  });
};

exports.getLaboCasesInTreatment = async (req, res) => {
  try {
    const { page = 1, perPage = 10, fetchAll } = req.query;
    const shouldPaginate = !fetchAll || fetchAll.toLowerCase() !== "true";
    const paginationOptions = shouldPaginate
      ? {
          take: parseInt(perPage),
          skip: (parseInt(page) - 1) * parseInt(perPage),
        }
      : {};

    const userRole = req.user.role;
    const whereCondition =
      userRole === "labo" ? { case_type: { in: ["N", "R"] } } : {};

    const findManyOptions = {
      where: whereCondition,
      select: {
        id: true,
        created_at: true,
        note: true,
        patient_id: true,
        patient: {
          select: {
            user: {
              select: {
                first_name: true,
                last_name: true,
                profile_pic: true,
              },
            },
          },
        },
        status_histories: {
          orderBy: { created_at: "desc" },
          take: 1, // Take the most recent status
          select: {
            name: true,
            created_at: true,
          },
        },
        construction_files: {
          orderBy: { created_at: "desc" },
          take: 1, // Take the most recent construction file
          select: {
            file_path: true,
            created_at: true,
          },
        },
        labo_links: {
          orderBy: { created_at: "desc" },
          take: 1, // Take the most recent labo link
          select: {
            pdf_file: true,
          },
        },
      },
      orderBy: {
        id: "desc",
      },
      ...paginationOptions,
    };

    const casesData = await prisma.cases.findMany(findManyOptions);

    const filteredCasesData = casesData.filter(
      (c) =>
        c.status_histories.length > 0 &&
        c.status_histories[0].name === statusDbEnum.in_construction
    );

    const currentTime = new Date();
    const cases = [];

    for (const caseItem of filteredCasesData) {
      const latestStatus = caseItem.status_histories[0];
      const latestConstructionFile =
        caseItem.construction_files.length > 0
          ? caseItem.construction_files[0]
          : null;
      const latestLaboLink =
        caseItem.labo_links.length > 0 ? caseItem.labo_links[0] : null;

      if (latestStatus) {
        const latestStatusCreatedAtString = latestStatus.created_at;
        const latestStatusCreatedAt = new Date(latestStatusCreatedAtString);

        if (isNaN(latestStatusCreatedAt.getTime())) {
          console.error("Invalid date format:", latestStatusCreatedAtString);
          continue; // Skip this iteration if the date is not valid
        }

        const secondsDifference = differenceInSeconds(
          currentTime,
          latestStatusCreatedAt
        );
        let thresholdSeconds = 86400;
        if (req.user.role == "hachem") thresholdSeconds = 172800;

        const isLate =
          !latestConstructionFile && secondsDifference >= thresholdSeconds;

        const lateTime = isLate
          ? Math.max(0, secondsDifference - thresholdSeconds)
          : null;
        const remainingTime = !isLate
          ? differenceInSeconds(
              addSeconds(latestStatusCreatedAt, thresholdSeconds),
              currentTime
            )
          : null;

        cases.push({
          id: caseItem.id.toString(),
          created_at: new Date(caseItem.created_at).toISOString(),
          note: caseItem.note || "Cause not specified",
          patient: {
            name: `${caseItem.patient.user.first_name} ${caseItem.patient.user.last_name}`,
            avatar:
              extractSingleImage(
                caseItem.patient.user.profile_pic,
                patient_image_url
              ) || "defaultAvatarURL",
          },
          require_smile_set_upload: latestConstructionFile
            ? "Done"
            : "Missing link",
          isLate,
          time: isLate ? lateTime : remainingTime,
          filePath: latestConstructionFile
            ? latestConstructionFile.file_path
            : null, // Safely handle the file path
          pdfFile: latestLaboLink ? latestLaboLink.pdf_file : null, // Safely handle the pdf_file
        });
      }
    }

    const sortedCases = cases.sort((a, b) =>
      a.require_smile_set_upload === "Missing link" &&
      b.require_smile_set_upload !== "Missing link"
        ? -1
        : b.require_smile_set_upload === "Missing link" &&
          a.require_smile_set_upload !== "Missing link"
        ? 1
        : 0
    );

    const totalCount = shouldPaginate
      ? await prisma.cases.count({ where: whereCondition })
      : sortedCases.length;

    return res.status(200).json({ cases: sortedCases, totalCount });
  } catch (error) {
    console.error("Error fetching cases:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
