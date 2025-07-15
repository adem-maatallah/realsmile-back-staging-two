const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");
const multer = require("multer");
const { uploadSingleStlFile } = require("../utils/googleCDN");
const { extractSingleImage } = require("../utils/caseUtils");

const prisma = new PrismaClient().$extends(withAccelerate());

const upload = multer({ storage: multer.memoryStorage() });
const cpUpload = upload.fields([{ name: "stls", maxCount: 3 }]);
const doctor_image_url = "https://realsmilealigner.com/upload/";

exports.createRetainingGutterWithPatientData = async (req, res) => {
  cpUpload(req, res, async (error) => {
    if (error) {
      console.error("Upload error:", error);
      return res.status(500).json({ error: error.message });
    }

    const { firstName, lastName, dateDeNaissance, sexe } = req.body;
    console.log("req.body:", req.body);
    let stlData = {};
    const user = req.user;
    console.log("user:", user);

    try {
      const doctor = await prisma.doctors.findFirst({
        where: { user_id: user.id },
      });

      if (!doctor) {
        return res.status(404).json({ message: "Doctor not found" });
      }

      const retainingGutter = await prisma.retaining_gutters.create({
        data: {
          doctor_id: doctor.id,
          patient_firstName: firstName,
          patient_lastName: lastName,
          patient_sexe: sexe,
          patient_birthDate: dateDeNaissance,
        },
      });

      console.log("retainingGutter:", retainingGutter);

      if (req.files && req.files.stls && req.files.stls.length > 0) {
        const stlUploadResults = await Promise.all(
          req.files.stls.map((file) =>
            uploadSingleStlFile(
              file,
              retainingGutter.id,
              process.env.GOOGLE_STORAGE_BUCKET_RETATAINING_GUTTERS
            )
          )
        );

        stlData = {
          stl_1: stlUploadResults[0] || null,
          stl_2: stlUploadResults[1] || null,
          stl_3: stlUploadResults[2] || null,
        };

        await prisma.retaining_gutters.update({
          where: { id: retainingGutter.id },
          data: stlData,
        });
      }

      res.status(201).json({
        message:
          "Retaining gutter with patient data and files created successfully",
      });
    } catch (err) {
      console.error("Error in createRetainingGutterWithPatientData:", err);
      res.status(500).json({ error: err.message });
    }
  });
};

exports.getAllRetainingGutters = async (req, res) => {
  const user = req.user;

  try {
    if (!user) {
      return res.status(500).json({ message: "User not found" });
    }

    const userRole = user.role;

    let retainingGutters;
    if (userRole == "admin" || userRole == "hachem") {
      retainingGutters = await prisma.retaining_gutters.findMany({
        include: {
          doctors: {
            include: {
              user: true,
            },
          },
        },
      });
    } else {
      const doctor = await prisma.doctors.findFirst({
        where: {
          user_id: user.id,
        },
        include: {
          user: true,
        },
      });

      if (!doctor) {
        return res.status(404).json({ message: "Doctor not found" });
      }

      retainingGutters = await prisma.retaining_gutters.findMany({
        where: {
          doctor_id: doctor.id,
        },
        include: {
          doctors: {
            include: {
              user: true,
            },
          },
        },
      });
    }

    const doctor_image_url =
      "https://storage.googleapis.com/realsmilefiles/staticFolder";
    const formattedRetainingGutters = retainingGutters.map((gutter) => ({
      id: gutter.id.toString(),
      created_at: new Date().toISOString(), // Assuming you don't have a created_at field
      patient: {
        name: `${gutter.patient_firstName || "Unknown"} ${
          gutter.patient_lastName || "Unknown"
        }`,
        date_of_birth: gutter.patient_birthDate || "Unknown",
      },
      doctor: {
        name: gutter.doctors.user
          ? `${gutter.doctors.user.first_name || "Unknown"} ${
              gutter.doctors.user.last_name || "Unknown"
            }`
          : "Unknown",
        avatar:
          extractSingleImage(
            gutter.doctors.user?.profile_pic,
            doctor_image_url
          ) ||
          "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png",
        phone: gutter.doctors.user
          ? gutter.doctors.user.phone || "pas de numéro de téléphone"
          : "pas de numéro de téléphone",
      },
      stls: [gutter.stl_1, gutter.stl_2, gutter.stl_3].filter((stl) => stl),
      status: gutter.status,
    }));

    return res
      .status(200)
      .json({ retainingGutters: formattedRetainingGutters });
  } catch (error) {
    console.error("Error fetching retaining gutters:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.sendRetainingGutters = async (req, res) => {
  const { caseId, trackingLink } = req.body;

  try {
    // Vérifier si le cas existe
    const caseExists = await prisma.retaining_gutters.findUnique({
      where: {
        id: BigInt(caseId),
      },
    });

    if (!caseExists) {
      return res.status(404).json({ message: "Case not found" });
    }

    // Mettre à jour le statut et le lien de suivi
    await prisma.retaining_gutters.update({
      where: {
        id: BigInt(caseId),
      },
      data: {
        status: "envoyé",
        lien_suivi: trackingLink,
      },
    });

    res.status(200).json({ message: "Case updated successfully" });
  } catch (error) {
    console.error("Error updating case:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
