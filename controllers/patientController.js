const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");
const asyncHandler = require("express-async-handler");

const prisma = new PrismaClient().$extends(withAccelerate());
const {
  SuccessResponse,
  InternelResponse,
} = require("../middlewares/apiResponse");
const { extractImagesHandle } = require("../utils/googleCDN");

const fetchPatients = async (req, res) => {
  try {
    const user = req.user;
    const { doctorId } = req.query;

    // Define the query configuration for including related data in the result
    const includeConfig = {
      user: {
        select: {
          profile_pic: true,
        },
      },
      doctor: {
        include: { user: true },
      },
      cases: {
        take: 1,
      },
    };

    const role = await prisma.roles.findFirst({
      where: { id: parseInt(user.role_id) },
    });

    if (!role) {
      throw new Error("User role not found.");
    }

    if (role.name === "admin") {
      return prisma.patients.findMany({
        include: includeConfig,
        orderBy: {
          created_at: "desc",
        },
      });
    } else if (role.name === "doctor") {
      return prisma.patients.findMany({
        where: {
          doctor: {
            user_id: BigInt(user.id), // Match user_id in doctors table
          },
        },
        include: includeConfig,
        orderBy: {
          created_at: "desc",
        },
      });
    } else if (role.name === "commercial") {
      if (!doctorId || isNaN(doctorId)) {
        throw new Error("Invalid or missing doctorId.");
      }

      // Find the doctor by user_id and validate commercial_id
      const assignedDoctor = await prisma.doctors.findFirst({
        where: {
          user_id: BigInt(doctorId), // Match doctor by user_id
          user: {
            commercial_id: BigInt(req.user.id), // Ensure the commercial_id matches the logged-in user
          },
        },
        include: {
          user: true, // Include user data for debugging/logging purposes
        },
      });

      if (!assignedDoctor) {
        console.error("Unauthorized access for commercial:", {
          doctorUserId: doctorId,
          commercialId: req.user.id,
        });
        res.status(401).json({ message: "Unauthorized access to doctor." });
        return null; // Exit early
      }

      return prisma.patients.findMany({
        where: {
          doctor_id: assignedDoctor.id, // Match patients to the found doctor's id
        },
        include: includeConfig,
        orderBy: {
          created_at: "desc",
        },
      });
    } else {
      throw new Error("Access denied due to unsupported role.");
    }
  } catch (error) {
    console.error("Error in fetchPatients:", error);
    return []; // Return an empty array on error to avoid null reference issues
  }
};

async function formatPatients(patients) {
  if (!Array.isArray(patients)) {
    console.error("Invalid patients data:", patients);
    return [];
  }

  const patient_image_url = "https://realsmilealigner.com/uploads/thumbnail/";
  const doctor_image_url = "https://realsmilealigner.com/upload/";
  return patients.map((patient) => {
    const doctorUser = patient.doctor?.user;
    return {
      id: patient.user_id?.toString(),
      patient: {
        name: patient.first_name + " " + patient.last_name,
        avatar:
          extractImagesHandle(patient.user?.profile_pic, patient_image_url) ||
          null,
        phone: patient.phone,
        gender: patient.gender,
        dateOfBirth: patient.date_of_birth || null,
        creationDate: patient.created_at || null,
      },
      doctor: doctorUser
        ? {
            id: doctorUser.id.toString(),
            name: doctorUser.first_name + " " + doctorUser.last_name,
            avatar:
              extractImagesHandle(doctorUser.profile_pic, doctor_image_url) ||
              null,
            phone: doctorUser.phone,
          }
        : null,
    };
  });
}

exports.getPatients = async (req, res) => {
  try {
    const patients = await fetchPatients(req, res);

    if (!patients) {
      // If fetchPatients returned null or empty array due to unauthorized access
      return; // Response is already sent in fetchPatients
    }

    const formattedPatients = await formatPatients(patients);
    const totalCount = await prisma.patients.count();

    res
      .status(200)
      .json(new SuccessResponse({ patients: formattedPatients, totalCount }));
  } catch (error) {
    console.error("Error fetching patients:", error);

    if (!res.headersSent) {
      res.status(500).json(new InternelResponse("Internal server error"));
    }
  }
};

/**
 * Send Reset OTP
 * Sends a password reset OTP to the user's phone number using Twilio Verify
 */
exports.sendResetOtp = asyncHandler(async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res
      .status(400)
      .json({ status: "fail", message: "Le numéro de téléphone est requis" });
  }

  try {
    // Check if user exists with this phone number
    const user = await prisma.users.findFirst({
      where: { phone: phoneNumber, role_id: 4 },
    });

    if (!user) {
      return res
        .status(404)
        .json({ status: "fail", message: "Utilisateur non trouvé" });
    }

    // Initialize Twilio client
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const verifySid = process.env.TWILIO_VERIFY_SID;

    const client = require("twilio")(accountSid, authToken);

    // Send verification code via Twilio Verify
    try {
      const verification = await client.verify.v2
        .services(process.env.TWILIO_SERVICE_SID)
        .verifications.create({ to: phoneNumber, channel: "sms" });

      console.log(
        `Verification sent to ${phoneNumber}: ${verification.status}`
      );

      // Create a password reset record
      // The OTP is managed by Twilio, so we don't need to store it
      // We'll just create a record to track the reset request
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + 1);

      await prisma.password_resets.upsert({
        where: { email: user.email },
        update: {
          token: "twilio-managed", // We don't know the actual code
          expiration_date: expirationDate,
          created_at: new Date(),
        },
        create: {
          email: user.email,
          token: "twilio-managed", // We don't know the actual code
          expiration_date: expirationDate,
          created_at: new Date(),
        },
      });

      return res.status(200).json({
        status: "success",
        message: "Code de vérification envoyé à votre téléphone.",
      });
    } catch (twilioError) {
      console.error("Twilio Verify error:", twilioError);
      return res.status(500).json({
        status: "error",
        message: "Erreur lors de l'envoi du code par SMS. Veuillez réessayer.",
      });
    }
  } catch (error) {
    console.error("Error in sendResetOtp:", error);
    return res.status(500).json({
      status: "error",
      message:
        "Une erreur s'est produite lors de l'envoi du code de vérification.",
    });
  }
});

/**
 * Verify Reset OTP
 * Verifies the password reset OTP sent via Twilio Verify
 */
exports.verifyResetOtp = asyncHandler(async (req, res) => {
  const { phoneNumber, verificationCode } = req.body;

  if (!phoneNumber || !verificationCode) {
    return res.status(400).json({
      status: "fail",
      message: "Le numéro de téléphone et le code de vérification sont requis",
    });
  }

  try {
    // Find the user with this phone number
    const user = await prisma.users.findFirst({
      where: { phone: phoneNumber },
    });

    if (!user) {
      return res
        .status(404)
        .json({ status: "fail", message: "Utilisateur non trouvé" });
    }

    // Find the reset record by email
    const resetRecord = await prisma.password_resets.findUnique({
      where: { email: user.email },
    });

    if (!resetRecord) {
      return res.status(400).json({
        status: "fail",
        message:
          "Aucune demande de réinitialisation trouvée. Veuillez demander un nouveau code.",
      });
    }

    // Check if token is expired
    const now = new Date();
    if (now > resetRecord.expiration_date) {
      return res.status(400).json({
        status: "fail",
        message: "Le code a expiré. Veuillez demander un nouveau code.",
      });
    }

    // Initialize Twilio client
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const verifySid = process.env.TWILIO_VERIFY_SID;

    const client = require("twilio")(accountSid, authToken);

    try {
      // Verify the code with Twilio
      const verificationCheck = await client.verify.v2
        .services(process.env.TWILIO_SERVICE_SID)
        .verificationChecks.create({ to: phoneNumber, code: verificationCode });

      if (verificationCheck.status === "approved") {
        // Update reset record to indicate verification is complete
        await prisma.password_resets.update({
          where: { email: user.email },
          data: {
            token: "verified", // Mark as verified
          },
        });

        // Token is valid, return success with the user ID for the next step
        return res.status(200).json({
          status: "success",
          message:
            "Code vérifié avec succès. Vous pouvez maintenant réinitialiser votre mot de passe.",
          userId: user.id.toString(),
        });
      } else {
        return res.status(400).json({
          status: "fail",
          message: "Code de vérification invalide. Veuillez réessayer.",
        });
      }
    } catch (twilioError) {
      console.error("Twilio Verify check error:", twilioError);
      return res.status(500).json({
        status: "error",
        message: "Erreur lors de la vérification du code. Veuillez réessayer.",
      });
    }
  } catch (error) {
    console.error("Error in verifyResetOtp:", error);
    return res.status(500).json({
      status: "error",
      message: "Une erreur s'est produite lors de la vérification du code.",
    });
  }
});

/**
 * Reset Password
 * Resets the user's password after OTP verification
 */
exports.resetPassword = asyncHandler(async (req, res) => {
  const { userId, newPassword, confirmPassword } = req.body;

  if (!userId || !newPassword || !confirmPassword) {
    return res.status(400).json({
      status: "fail",
      message:
        "L'ID utilisateur, le nouveau mot de passe et la confirmation sont requis",
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      status: "fail",
      message: "Les mots de passe ne correspondent pas",
    });
  }

  // Basic password validation
  if (newPassword.length < 8) {
    return res.status(400).json({
      status: "fail",
      message: "Le mot de passe doit contenir au moins 8 caractères",
    });
  }

  try {
    const userIdBigInt = BigInt(userId);

    // Find the user
    const user = await prisma.users.findUnique({
      where: { id: userIdBigInt },
    });

    if (!user) {
      return res
        .status(404)
        .json({ status: "fail", message: "Utilisateur non trouvé" });
    }

    // Find the reset record
    const resetRecord = await prisma.password_resets.findUnique({
      where: { email: user.email },
    });

    if (!resetRecord || resetRecord.token !== "verified") {
      return res.status(400).json({
        status: "fail",
        message:
          "Veuillez vérifier votre code avant de réinitialiser le mot de passe",
      });
    }

    // Check if token is expired
    const now = new Date();
    if (now > resetRecord.expiration_date) {
      return res.status(400).json({
        status: "fail",
        message:
          "La session de réinitialisation a expiré. Veuillez recommencer.",
      });
    }

    // Hash the new password
    const bcrypt = require("bcrypt");
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password
    await prisma.users.update({
      where: { id: userIdBigInt },
      data: {
        password: hashedPassword,
        updated_at: new Date(),
      },
    });

    // Delete the reset record to prevent reuse
    await prisma.password_resets.delete({
      where: { email: user.email },
    });

    return res.status(200).json({
      status: "success",
      message:
        "Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.",
    });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    return res.status(500).json({
      status: "error",
      message:
        "Une erreur s'est produite lors de la réinitialisation du mot de passe.",
    });
  }
});
