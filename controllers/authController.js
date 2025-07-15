const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");

const prisma = new PrismaClient().$extends(withAccelerate());

const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const {
  BadRequestError,
  UnauthorizedError,
  AccessTokenError,
  TokenExpiredError,
  NotFoundError,
} = require("../middlewares/apiError");
const {
  SuccessResponse,
  SuccessMsgDataResponse,
  SuccessMsgResponse,
} = require("../middlewares/apiResponse");

const { tokenInfo } = require("./../config");
const sendEmail = require("./../utils/email");
const bcrypt = require("bcryptjs");
const { getAuth } = require("firebase-admin/auth");
const { uploadSingleFile } = require("../utils/googleCDN");
const multer = require("multer");
const { default: axios } = require("axios");
const { extractSingleImage } = require("../utils/caseUtils");
const queueEmail = require("./../utils/email");
const accountSid = process.env.TWILIO_TEST_ACCOUNT_SID;
const authToken = process.env.TWILIO_TEST_AUTH_TOKEN;
const client = require("twilio")(accountSid, authToken);
const upload = multer({ storage: multer.memoryStorage() });
const cpUpload = upload.fields([{ name: "profile_pic", maxCount: 1 }]);
const doctor_image_url = "https://realsmilealigner.com/upload/";
const admin = require("firebase-admin");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const { createMobileUserUtils } = require("../firebase/mobileUser");
const cls = require("cls-hooked");
const { doctorAuth } = require("../utils/firebaseConfig");

const tokenExpiryInSeconds = 604800;

const signToken = (userId, role) => {
  return jwt.sign(
    {
      userId,
      role,
    },
    process.env.SECRET
  );
};

const createSendTokenMobile = async (user, req, res) => {
  user.id = Number(user.id);
  user.role_id = Number(user.role_id);

  const token = signToken(user.id, user.role.name);

  // Set the cookie to expire in 10 years
  const expirationDate = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

  res.cookie("jwt", token, {
    expires: expirationDate,
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
  });

  const roleName = user.role ? user.role.name : "doctor";
  if (roleName === "doctor") {
    const doctorDetails = await prisma.doctors.findUnique({
      where: {
        user_id: user.id,
      },
    });
    if (!doctorDetails) {
      return new BadRequestError("No doctor details found", 404);
    }
    user = {
      ...user,
      speciality: doctorDetails.speciality,
      office_phone: doctorDetails.office_phone,
      address: doctorDetails.address,
      address_2: doctorDetails.address_2,
      city: doctorDetails.city,
      zip: doctorDetails.zip,
    };
  }

  const userResponse = {
    ...user,
    token,
    role: roleName,
    tokenExpires: expirationDate.getTime(),
    commercial_id: Number(user.commercial_id),
  };
  new SuccessResponse({
    user: userResponse,
    token,
  }).send(res);
};

const createSendToken = async (user, req, res) => {
  user.id = Number(user.id);
  user.role_id = Number(user.role_id);
  user.commercial_id = Number(user.commercial_id);

  const token = signToken(user.id, user.role.name);
  const expirationDate = new Date(Date.now() + tokenExpiryInSeconds * 1000);

  res.cookie("jwt", token, {
    expires: expirationDate,
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
  });

  const roleName = user.role ? user.role.name : "doctor";
  if (roleName === "doctor") {
    const doctorDetails = await prisma.doctors.findUnique({
      where: {
        user_id: user.id,
      },
    });
    if (!doctorDetails) {
      throw new BadRequestError("No doctor details found", 404);
    }
    user = {
      ...user,
      speciality: doctorDetails.speciality,
      office_phone: doctorDetails.office_phone,
      address: doctorDetails.address,
      address_2: doctorDetails.address_2,
      city: doctorDetails.city,
      zip: doctorDetails.zip,
    };
  }

  const userResponse = {
    ...user,
    token,
    role: roleName,
    tokenExpires: expirationDate.getTime(), // Ensure this is a timestamp
  };

  new SuccessResponse({
    user: userResponse,
    token,
  }).send(res);
};
function sanitizeBigInts(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeBigInts);
  } else if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, val]) => [
        key,
        typeof val === "bigint" ? Number(val) : sanitizeBigInts(val),
      ])
    );
  }
  return obj;
}

// CAPTCHA LOGIN
// exports.login = async (req, res) => {
//   try {
//     const { email, password, captchaToken, isMobileApp } = req.body;
//     console.log("captchaToken:",captchaToken )
//     console.log("isMobileApp:",isMobileApp )
//     // Fetch user from database
//     const user = await prisma.users.findUnique({
//       where: { email },
//       include: { role: true },
//     });

//     if (!user) {
//       return res
//         .status(401)
//         .json({ message: "Email ou mot de passe incorrect." });
//     }

//     // Verify password
//     const passwordVerified = await bcrypt.compare(password, user.password);
//     if (!passwordVerified) {
//       return res
//         .status(401)
//         .json({ message: "Email ou mot de passe incorrect." });
//     }

//     // Conditional reCAPTCHA verification for web app
//     if (!isMobileApp) {
//       const verifyCaptcha = await axios.post(
//         `https://www.google.com/recaptcha/api/siteverify`,
//         null,
//         {
//           params: {
//             secret: process.env.RECAPTCHA_SECRET_KEY,
//             response: captchaToken,
//           },
//         }
//       );

//       if (!verifyCaptcha.data.success) {
//         return res.status(400).json({
//           message: "Échec de la vérification reCAPTCHA. Veuillez réessayer.",
//         });
//       }
//     }

//     // Reset failed login attempts on successful login
//     await prisma.users.update({
//       where: { email },
//       data: {
//         last_login: new Date(),
//       },
//     });

//     // Convert BigInt values to regular numbers
//     user.commercial_id = Number(user.commercial_id);
//     user.id = Number(user.id);
//     user.role_id = Number(user.role_id);
//     if (user.role && user.role.id) {
//       user.role.id = Number(user.role.id);
//     }

//     // Ensure profile_pic has a default value
//     user.profile_pic =
//       extractSingleImage(user?.profile_pic, doctor_image_url) ||
//       "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";

//     // Get related cases (optional, used for session)
//     const doctor = await prisma.doctors.findUnique({
//       where: { user_id: user.id },
//     });

//     const patient = await prisma.patients.findUnique({
//       where: { user_id: user.id },
//     });

//     let relatedCases = [];
//     if (doctor) {
//       relatedCases = await prisma.cases.findMany({
//         where: { doctor_id: doctor.id },
//         select: { id: true },
//       });
//     } else if (patient) {
//       relatedCases = await prisma.cases.findMany({
//         where: { patient_id: patient.id },
//         select: { id: true },
//       });
//     }

//     const caseIds = relatedCases.map((c) => Number(c.id));

//     const roles = {
//       1: "admin",
//       2: "labo",
//       3: "doctor",
//       4: "patient",
//       5: "finance",
//       7: "hachem",
//     };
//     const role = roles[user.role_id] || "patient";

//     // Mobile: Firebase custom token
//     if (isMobileApp) {
//       const firebaseToken = await doctorAuth
//         .createCustomToken(user.id.toString());

//       return res.status(200).json({
//         success: true,
//         message: "Login successful",
//         firebaseToken,
//         user,
//       });
//     }

//     // Web: Create JWT token and attach session
//     const token = jwt.sign({ userId: user.id, role }, process.env.SECRET);
//     const tokenExpires = Date.now() + 1000 * 60 * 60 * 24 * 7;

//     // Save session data
//     req.session.userId = user.id;
//     req.session.role = role;
//     req.session.role_id = user.role_id;
//     req.session.email = user.email;
//     req.session.phone = user.phone;
//     req.session.firstName = user.first_name;
//     req.session.lastName = user.last_name;
//     req.session.cases = caseIds;
//     req.session.profilePic = user.profile_pic;

//     req.session.save((err) => {
//       if (err) {
//         console.error("Session save error:", err);
//         return res.status(500).json({
//           message: "Erreur lors de la sauvegarde de session.",
//         });
//       }
//       return res.status(200).json({
//         success: true,
//         message: "Login successful",
//         token,
//         tokenExpires,
//         user,
//       });
//     });
//   } catch (error) {
//     console.log(error);
//     return res.status(500).json({
//       message: "Une erreur est survenue. Veuillez réessayer plus tard.",
//     });
//   }
// };

// NO CAPTCHA LOGIN
exports.loginPatient = async (req, res) => {
  try {
    const { email, password, phone, isMobileApp } = req.body;
    console.log("isMobileApp:", isMobileApp);

    let user;

    // Determine if login is by email or phone
    if (email) {
      user = await prisma.users.findUnique({
        where: { email },
        include: { role: true },
      });
    } else if (phone) {
      user = await prisma.users.findUnique({
        where: { phone },
        include: { role: true },
      });
    } else {
      return res
        .status(400)
        .json({ message: "Email or phone number is required." });
    }

    if (!user || user.deleted) { // Added user.deleted check from your second function
      return res
        .status(401)
        .json({ message: "Email, phone number, or password incorrect." });
    }

    // Verify password
    const passwordVerified = await bcrypt.compare(password, user.password);
    if (!passwordVerified) {
      return res
        .status(401)
        .json({ message: "Email, phone number, or password incorrect." });
    }

    // Reset last_login on successful login
    await prisma.users.update({
      where: { id: user.id }, // Changed to user.id for consistency
      data: { last_login: new Date() },
    });

    // Normalize BigInts to numbers
    user.commercial_id = Number(user.commercial_id);
    user.id = Number(user.id);
    user.role_id = Number(user.role_id);
    if (user.role && user.role.id) {
      user.role.id = Number(user.role.id);
    }

    // Default profile picture
    // Ensure `extractSingleImage` and `doctor_image_url` are defined or replace with static URL
    user.profile_pic =
      (typeof extractSingleImage !== 'undefined' && extractSingleImage(user?.profile_pic, doctor_image_url)) ||
      "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";

    // Gather related case IDs
    const doctor = await prisma.doctors.findUnique({ where: { user_id: user.id } });
    const patient = await prisma.patients.findUnique({ where: { user_id: user.id } });

    let relatedCases = [];
    if (doctor) {
      relatedCases = await prisma.cases.findMany({
        where: { doctor_id: doctor.id },
        select: { id: true },
      });
    } else if (patient) {
      relatedCases = await prisma.cases.findMany({
        where: { patient_id: patient.id },
        select: { id: true },
      });
    }
    const caseIds = relatedCases.map(c => Number(c.id));

    // Determine role string
    const rolesMap = { 1: "admin", 2: "labo", 3: "doctor", 4: "patient", 5: "finance", 7: "hachem" };
    const role = rolesMap[user.role_id] || "patient";

    // Mobile: Firebase custom token
    if (isMobileApp) {
      // Ensure doctorAuth is properly imported and configured
      const firebaseToken = await doctorAuth.createCustomToken(user.id.toString());
      return res.status(200).json({
        success: true,
        message: "Login successful",
        firebaseToken,
        user,
      });
    }

    // Web: issue JWT + session
    const token = jwt.sign({ userId: user.id, role }, process.env.SECRET);
    const tokenExpires = Date.now() + 1000 * 60 * 60 * 24 * 7;

    req.session.userId = user.id;
    req.session.role = role;
    req.session.role_id = user.role_id;
    req.session.email = user.email;
    req.session.phone = user.phone; // Add phone to session
    req.session.firstName = user.first_name;
    req.session.lastName = user.last_name;
    req.session.cases = caseIds;
    req.session.profilePic = user.profile_pic;

    req.session.save(err => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({
          message: "Erreur lors de la sauvegarde de session.",
        });
      }
      return res.status(200).json({
        success: true,
        message: "Login successful",
        token,
        tokenExpires,
        user,
      });
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    });
  }
};

// login of staging with captcha

exports.loginDoctor = async (req, res) => {
  try {
    const { email, password, captchaToken, isMobileApp, phone } = req.body;
    let user;
    console.log("captchaToken:",captchaToken )
    user = await prisma.users.findUnique({
      where: { email },
      include: { role: true },
    });

    if (!user) {
      return res
        .status(401)
        .json({ status: "fail", message: "Email ou mot de passe incorrect." });
    }

    if (user.status === false) {
      return res.status(403).json({
        status: "fail",
        message:
          "Votre compte est inactif. Veuillez contacter l'administration.",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ status: "fail", message: "Email ou mot de passe incorrect." });
    }

    // Optional CAPTCHA check for allowed domains
    const origin = req.headers.origin || req.headers.referer || "";
    const allowedDomains = [
      "https://realsmile.app",
      "https://beta.realsmile.app",
    ];
    if (allowedDomains.some((domain) => origin.startsWith(domain))) {
      if (!captchaToken) {
        return res
          .status(400)
          .json({ status: "fail", message: "Captcha token is required." });
      }

      const captchaResponse = await axios.post(
        "https://www.google.com/recaptcha/api/siteverify",
        null,
        {
          params: {
            secret: process.env.RECAPTCHA_SECRET_KEY,
            response: captchaToken,
          },
        }
      );
      if (!captchaResponse.data.success) {
        return res.status(400).json({
          status: "fail",
          message: "Échec de la vérification reCAPTCHA. Veuillez réessayer.",
        });
      }
    }

    // Get doctor or patient to find related cases
    const doctor = await prisma.doctors.findUnique({
      where: { user_id: user.id },
    });
    const patient = await prisma.patients.findUnique({
      where: { user_id: user.id },
    });

    let relatedCases = [];
    if (doctor) {
      relatedCases = await prisma.cases.findMany({
        where: { doctor_id: doctor.id },
        select: { id: true },
      });
    } else if (patient) {
      relatedCases = await prisma.cases.findMany({
        where: { patient_id: patient.id },
        select: { id: true },
      });
    }
    // Map cases to a list of integer IDs
    const caseIds = relatedCases.map((c) => Number(c.id));

    // Update last login
    const identifier = email ? { email } : { phone };
    await prisma.users.update({
      where: identifier,
      data: { last_login: new Date() },
    });

    // Generate role string using numeric role_id from the database
    const roles = {
      1: "admin",
      2: "labo",
      3: "doctor",
      4: "patient",
      5: "finance",
      7: "hachem",
    };
    const role = roles[user.role_id] || "patient";

    const userId = Number(user.id);
    const roleId = Number(user.role_id);

    // Generate token and compute expiry (same for both mobile and non-mobile)
    let token, tokenExpires;
    if (isMobileApp) {
      token = await doctorAuth.createCustomToken(userId.toString());
      tokenExpires = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
    } else {
      token = jwt.sign({ userId, role }, process.env.SECRET);
      tokenExpires = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
    }

    // Prepare a flat response object containing all required fields
    const responseData = sanitizeBigInts({
      ...user,
      cases: caseIds,
      id: userId,
      role_id: roleId,
      role,
      token,
      tokenExpires,
    });

    // Mobile branch: return response immediately
    if (isMobileApp) {
      return res.status(200).json({
        status: "success",
        data: responseData,
      });
    }

    // Non-mobile: store session data (with both role and role_id) and then return response.
    req.session.userId = userId;
    req.session.role = role;
    req.session.role_id = roleId; // Save numeric role_id in session
    req.session.email = user.email;
    req.session.phone = user.phone;
    req.session.firstName = user.first_name;
    req.session.lastName = user.last_name;
    req.session.cases = caseIds;
    req.session.profilePic =
      user.profile_pic ||
      "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";

    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({
          status: "fail",
          message:
            "Une erreur est survenue lors de la sauvegarde de la session.",
        });
      }
      return res.status(200).json({
        status: "success",
        data: responseData,
      });
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      status: "fail",
      message: "Une erreur est survenue. Veuillez réessayer plus tard.",
    });
  }
};

exports.loginSms = asyncHandler(async (req, res) => {
  try {
    let { phone, otp, id } = req.body;
    phone = phone.replace(/\s+/g, "");

    let user;
    if (id) {
      // If ID is provided in the request, update the user with this ID
      user = await prisma.users.update({
        where: { id },
        data: { phone, phone_verified: true }, // Assuming you want to update the phone number; adjust according to your needs
        include: {
          role: true,
        },
      });
    } else {
      // Find the user uniquely by phone number if no ID is provided
      user = await prisma.users.findUnique({
        where: { phone },
        include: {
          role: true,
        },
      });
    }

    // Perform the OTP verification with Twilio
    const verification_check = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: phone, code: otp });

    if (verification_check.status === "approved") {
      await prisma.users.update({
        where: { id: user.id },
        data: { last_login: new Date() },
      });
      user.profile_pic =
        extractSingleImage(user?.profile_pic, doctor_image_url) ||
        "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";
      createSendToken(user, req, res);
    } else {
      throw new BadRequestError("Invalid verification code.");
    }
  } catch (error) {
    console.log(error);
    throw new BadRequestError(error.message);
  }
});
// logout
exports.logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res
        .status(500)
        .json({ status: "fail", message: "Unable to log out" });
    }
    // Example if path was '/' (default for express-session)
    res.clearCookie("realsmile.session", { path: '/' });    return res
      .status(200)
      .json({ status: "success", message: "Logged out successfully" });
  });
};

/**
 * Send OTP to user's phone for login
 * @route POST /api/auth/send-login-otp
 * @access Public
 */
exports.sendLoginOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        status: "fail",
        message: "Phone number is required",
      });
    }

    // Find user by phone number
    const user = await prisma.users.findUnique({
      where: { phone },
      include: { role: true },
    });

    // Check if user exists
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "No account found with this phone number",
      });
    }

    // Check if user account is active
    if (user.status === false) {
      return res.status(403).json({
        status: "fail",
        message: "Your account is inactive. Please contact administration.",
      });
    }

    // Initialize Twilio client
    const client = require("twilio")(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    // Send OTP via Twilio
    const verification = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: phone, channel: "sms" });

    return res.status(200).json({
      status: "success",
      message: "Verification code sent successfully",
      data: {
        phone: phone,
        verificationSid: verification.sid,
      },
    });
  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({
      status: "fail",
      message:
        "An error occurred while sending verification code. Please try again later.",
    });
  }
};

/**
 * Verify OTP and login user
 * @route POST /api/auth/verify-login-otp
 * @access Public
 */
exports.verifyLoginOtp = async (req, res) => {
  try {
    const { phone, otp, isMobileApp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        status: "fail",
        message: "Phone number and verification code are required",
      });
    }

    // Find user by phone number
    const user = await prisma.users.findUnique({
      where: { phone },
      include: { role: true },
    });

    // Check if user exists
    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "No account found with this phone number",
      });
    }

    // Check if user account is active
    if (user.status === false) {
      return res.status(403).json({
        status: "fail",
        message: "Your account is inactive. Please contact administration.",
      });
    }

    // Initialize Twilio client
    const client = require("twilio")(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    // Verify OTP via Twilio
    const verification_check = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: phone, code: otp });

    if (verification_check.status !== "approved") {
      return res.status(400).json({
        status: "fail",
        message: "Invalid verification code. Please try again.",
      });
    }

    // Get doctor or patient to find related cases
    const doctor = await prisma.doctors.findUnique({
      where: { user_id: user.id },
    });

    const patient = await prisma.patients.findUnique({
      where: { user_id: user.id },
    });

    let relatedCases = [];
    if (doctor) {
      relatedCases = await prisma.cases.findMany({
        where: { doctor_id: doctor.id },
        select: { id: true },
      });
    } else if (patient) {
      relatedCases = await prisma.cases.findMany({
        where: { patient_id: patient.id },
        select: { id: true },
      });
    }

    // Map cases to a list of integer IDs
    const caseIds = relatedCases.map((c) => Number(c.id));

    // Update last login
    await prisma.users.update({
      where: { phone },
      data: { last_login: new Date() },
    });

    // Generate role string using numeric role_id from the database
    const roles = {
      1: "admin",
      2: "labo",
      3: "doctor",
      4: "patient",
      5: "finance",
      7: "hachem",
    };

    const role = roles[user.role_id] || "patient";
    const userId = Number(user.id);
    const roleId = Number(user.role_id);

    // Generate token and compute expiry
    let token, tokenExpires;
    if (isMobileApp) {
      token = await doctorAuth.createCustomToken(userId.toString());
      tokenExpires = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
    } else {
      token = jwt.sign({ userId, role }, process.env.SECRET);
      tokenExpires = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
    }

    // Prepare a flat response object containing all required fields
    const responseData = sanitizeBigInts({
      ...user,
      cases: caseIds,
      id: userId,
      role_id: roleId,
      role,
      token,
      tokenExpires,
    });

    // Mobile branch: return response immediately
    if (isMobileApp) {
      return res.status(200).json({
        status: "success",
        data: responseData,
      });
    }

    // Non-mobile: store session data
    req.session.userId = userId;
    req.session.role = role;
    req.session.role_id = roleId;
    req.session.email = user.email;
    req.session.phone = user.phone;
    req.session.firstName = user.first_name;
    req.session.lastName = user.last_name;
    req.session.cases = caseIds;
    req.session.profilePic =
      user.profile_pic ||
      "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";

    req.session.save((err) => {
      if (err) {
        console.error("Session save error:", err);
        return res.status(500).json({
          status: "fail",
          message: "An error occurred during session save.",
        });
      }

      return res.status(200).json({
        status: "success",
        data: responseData,
      });
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    return res.status(500).json({
      status: "fail",
      message: "An error occurred during verification. Please try again later.",
    });
  }
};
exports.checkQrCode = asyncHandler(async (req, res) => {
  try {
    const { qr_code } = req.params; // Get qr_code from request parameters

    // Check if the QR code exists in the Device table and fetch related case
    const device = await prisma.device.findFirst({
      where: { code: qr_code },
      include: {
        cases: {
          include: {
            patient: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!device) {
      return res
        .status(404)
        .json({ exists: false, message: "QR code not found." });
    }

    // Check if related user/patient account has been activated
    const userStatus = device.cases.patient.user.status;

    if (userStatus === true) {
      return res.status(400).json({
        exists: true,
        activated: true,
        message: "Votre compte a déjà été activé.",
      });
    }

    // Return patient information for pre-filling the registration form
    const patientInfo = {
      firstName: device.cases.patient.first_name || "",
      lastName: device.cases.patient.last_name || "",
      email: device.cases.patient.user?.email || "",
      phone: device.cases.patient.user?.phone || "",
    };

    res.status(200).json({
      exists: true,
      activated: false,
      patient: patientInfo,
      message: "QR code exists and account is not activated.",
    });
  } catch (error) {
    console.error("Error checking QR code:", error);
    res.status(500).json({ exists: false, message: "Server error." });
  }
});
exports.getDoctorData = asyncHandler(async (req, res) => {
  const { qr_code } = req.params;
  console.log("we re inside get doctor data");
  try {
    // Find the device entry to get the case_id
    const device = await prisma.device.findUnique({
      where: { code: qr_code },
    });

    if (!device) {
      return res.status(404).json({ message: "QR code not found." });
    }

    const caseId = device.case_id;

    if (!caseId) {
      return res
        .status(400)
        .json({ message: "No case associated with this QR code." });
    }

    // Fetch doctor_id from the Cases table using case_id
    const caseRecord = await prisma.cases.findUnique({
      where: { id: BigInt(caseId) },
      include: { doctor: true }, // Ensure the Cases model has the doctor relation set up
    });
    console.log("caseRecord", caseRecord);
    if (!caseRecord || !caseRecord.doctor) {
      return res
        .status(400)
        .json({ message: "No doctor associated with this case." });
    }

    const doctorId = caseRecord.doctor.id;

    // Fetch user information (first_name, last_name) from the Doctors table using doctor_id
    const doctor = await prisma.doctors.findUnique({
      where: { id: BigInt(doctorId) },
      include: { user: true }, // Ensure the Doctor model has the user relation set up
    });

    if (!doctor || !doctor.user) {
      return res
        .status(400)
        .json({ message: "Doctor user information not found." });
    }

    // Return doctor information and case ID
    res.status(200).json({
      doctor: {
        first_name: doctor.user.first_name,
        last_name: doctor.user.last_name,
      },
      case_id: String(Number(caseId)),
    });
  } catch (error) {
    console.error("Error fetching doctor info:", error);
    res.status(500).json({ message: "Server error." });
  }
});
exports.refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.body.refreshToken;

  if (!refreshToken) {
    return res
      .status(401)
      .json({ status: "fail", message: "Refresh token missing" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.SECRET);
    const newToken = signToken(decoded.userId, decoded.role);
    const newRefreshToken = signToken(decoded.userId, decoded.role, "30d");

    res.cookie("jwt", newToken, {
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    });

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    });

    return new SuccessResponse({
      token: newToken,
      refreshToken: newRefreshToken,
    }).send(res);
  } catch (error) {
    return res
      .status(401)
      .json({ status: "fail", message: "Invalid refresh token" });
  }
});
// creates user entry
exports.signUp = asyncHandler(async (req, res) => {
  const { firstName, lastName, userName, email, password, passwordConfirm } =
    req.body;

  if (password !== passwordConfirm) {
    throw new BadRequestError("Passwords do not match");
  }

  const existingUser = await prisma.users.findUnique({
    where: { email },
    where: { user_name },
  });
  if (existingUser) {
    throw new BadRequestError(
      "A user with this email or username already exists"
    );
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  const newUser = {
    firstName,
    lastName,
    userName,
    email,
    password: hashedPassword,
    role: "User",
    status: "Active",
  };
  await prisma.users.create({
    data: {
      firstName,
      lastName,
      userName,
      email,
      password: hashedPassword,
      role: "User",
      status: "Active",
    },
  });
  createSendToken(newUser, req, res);
});
exports.signUpPatient = asyncHandler(async (req, res, next) => {
  try {
    console.log("File:", req.file);
    console.log("Body:", req.body);

    const {
      case_id,
      first_name,
      last_name,

      email,
      password,
      confirm_password,
      phone,
      country,
      date_of_birth,
      gender,
    } = req.body;
    console.log("req.body: ", req.body);

    // Check if passwords match
    if (password !== confirm_password) {
      return res
        .status(400)
        .json({ status: "fail", message: "Mot de passe n'est pas compatible" });
    }

    // Find the patient_id associated with the provided case_id
    const caseRecord = await prisma.cases.findUnique({
      where: { id: BigInt(case_id) },
      select: { patient_id: true },
    });

    if (!caseRecord) {
      return res
        .status(404)
        .json({ status: "fail", message: "Case not found" });
    }

    const patient_id = caseRecord.patient_id;

    if (!patient_id) {
      return res.status(404).json({
        status: "fail",
        message: "No patient associated with this case",
      });
    }

    // Find the user_id in the patients table
    const patientRecord = await prisma.patients.findUnique({
      where: { id: BigInt(patient_id) },
      select: { user_id: true },
    });

    if (!patientRecord || !patientRecord.user_id) {
      return res
        .status(404)
        .json({ status: "fail", message: "Patient record not found" });
    }

    const user_id = patientRecord.user_id;

    // Check if the email or phone is already in use by a non-deleted user
    const existingUserByEmail = await prisma.users.findFirst({
      where: {
        email,
        deleted: false, // Exclude deleted users
        id: { not: BigInt(user_id) },
      },
    });
    console.log("existingUserByEmail:", existingUserByEmail);
    if (existingUserByEmail) {
      return res
        .status(400)
        .json({ status: "fail", message: "Cet email est déjà utilisé." });
    }

    const existingUserByPhone = await prisma.users.findFirst({
      where: {
        phone,
        deleted: false, // Exclude deleted users
        id: { not: BigInt(user_id) },
      },
    });

    if (existingUserByPhone) {
      return res.status(400).json({
        status: "fail",
        message: "Ce numéro de téléphone est déjà utilisé.",
      });
    }

    // Process profile picture file if it exists
    let profilePicUrl = null;
    if (req.file) {
      profilePicUrl = req.file.cloudStoragePublicUrl; // Use the public URL from Google Cloud Storage
      console.log("Profile picture uploaded to:", profilePicUrl);
    } else {
      profilePicUrl =
        "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";
    }

    // Generate a unique username based on first and last name
    let baseUsername = `${first_name}_${last_name}`.toLowerCase();
    let username = await generateUniqueUsername(baseUsername);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update the user record
    const updatedUser = await prisma.users.update({
      where: { id: BigInt(user_id) },
      data: {
        first_name,
        last_name,
        email,
        password: hashedPassword,
        phone,
        country,
        user_name: username,
        profile_pic: profilePicUrl,
        status: true,
        deleted: false, // Reactivate the user if they were previously deleted
        updated_at: new Date(),
      },
    });

    // Update the patient record
    const updatedPatient = await prisma.patients.update({
      where: { id: BigInt(patient_id) },
      data: {
        first_name,
        last_name,
        date_of_birth,
        gender,
        updated_at: new Date(),
      },
    });

    const serializedUser = {
      ...updatedUser,
      id: Number(updatedUser.id),
      role_id: Number(updatedUser.role_id),
    };

    console.log("User and Patient updated successfully");

    res.status(200).json({
      status: "success",
      user: serializedUser,
    });
  } catch (error) {
    console.error("SignUp Error:", error);
    return res
      .status(500)
      .json({ status: "fail", message: "Registration failed" });
  }
});
async function generateUniqueUsername(baseUsername) {
  let username = baseUsername;
  let suffix = 1;

  // Keep checking if the username exists, and if so, append a number to make it unique
  while (
    await prisma.users.findFirst({
      where: {
        user_name: username, // Checking if username already exists
      },
    })
  ) {
    username = `${baseUsername}${suffix}`;
    suffix++;
  }

  return username;
}
// User signup for unassigned patients (no case_id required)
exports.signUpUnassigned = asyncHandler(async (req, res, next) => {
  try {
    console.log("File:", req.file);
    console.log("Body:", req.body);

    const {
      first_name,
      last_name,
      email,
      password,
      confirm_password,
      phone,
      country,
      date_of_birth,
      gender,
    } = req.body;

    if (password !== confirm_password) {
      return res
        .status(400)
        .json({ status: "fail", message: "Mot de passe n'est pas compatible" });
    }

    // Check if email or phone already exists
    const existingEmail = await prisma.users.findFirst({
      where: { email, deleted: false },
    });
    if (existingEmail) {
      return res
        .status(400)
        .json({ status: "fail", message: "Cet email est déjà utilisé." });
    }

    const existingPhone = await prisma.users.findFirst({
      where: { phone, deleted: false },
    });
    if (existingPhone) {
      return res.status(400).json({
        status: "fail",
        message: "Ce numéro de téléphone est déjà utilisé.",
      });
    }

    // const profilePicUrl = req.file?.cloudStoragePublicUrl
    //   || "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png";

    const baseUsername = `${first_name}_${last_name}`.toLowerCase();
    const username = await generateUniqueUsername(baseUsername);
    const hashedPassword = await bcrypt.hash(password, 10);

    const role = await prisma.roles.findFirst({
      where: { name: "patient" },
    });

    const user = await prisma.users.create({
      data: {
        first_name,
        last_name,
        email,
        password: hashedPassword,
        phone,
        country,
        user_name: username,
        // profile_pic: profilePicUrl,
        status: true,
        deleted: false,
        role_id: role.id,
        created_at: new Date(),
      },
    });

    const patient = await prisma.patients.create({
      data: {
        first_name,
        last_name,
        date_of_birth,
        gender,
        user_id: user.id,
        doctor_id: 76, // Set to default doctor
        created_at: new Date(),
        date_of_birth,
        gender,
        assigned: false,
      },
    });

    const serializedUser = {
      ...user,
      id: Number(user.id),
      role_id: Number(user.role_id),
    };
    console.log("serializedUser:", serializedUser);
    res.status(201).json({
      status: "success",
      user: serializedUser,
      patient_id: Number(patient.id),
    });
  } catch (error) {
    console.error("SignUp (Unassigned) Error:", error);
    return res
      .status(500)
      .json({ status: "fail", message: "Registration failed" });
  }
});
// exports.getMe = asyncHandler(async (req, res) => {
//   const user = await prisma.users.findUnique({
//     where: { id: req.user.id },
//   });

//   if (!user) {
//     throw new TokenExpiredError("Token expired");
//   }

//   const responseData = {
//     email: user.email,
//     first_name: user.first_name,
//     last_name: user.last_name,
//     user_name: user.user_name,
//     phone: user.phone,
//     profile_pic: user.profile_pic,
//     country: user.country,
//   };

//   return new SuccessResponse(responseData).send(res);
// });

// Me request of staging
exports.getMe = async (req, res) => {
  // Extract session data (note: using role_id, not roleId)
  const { userId, email, role, role_id } = req.session;

  // Check if the session contains the user data
  if (!userId || !email || !role || !role_id) {
    return res.status(401).json({
      status: "fail",
      message: "You are not logged in! Please log in to get access.",
    });
  }

  const user = await prisma.users.findUnique({
    where: { id: req.session.userId },
  });

  if (!user) {
    return res.status(404).json({
      status: "fail",
      message: "User not found in the database.",
    });
  }

  // Return user data with consistent fields from the session
  res.status(200).json({
    status: "success",
    data: {
      user: {
        id: userId,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        user_name: user.user_name,
        phone: user.phone,
        profile_pic: user.profile_pic,
        has_mobile_account: user.has_mobile_account,
        country: user.country,
        two_factor_enabled: user.two_factor_enabled,
        status: user.status,
        phone_verified: user.phone_verified,
        email_verified: user.email_verified,
        longitude: user.longitude,
        latitude: user.latitude,
        cases: req.session.cases,
        role, // e.g. "patient"
        roleId: role_id, // numeric role id from session
      },
    },
  });
};

// delete patient account
exports.deleteAccount = asyncHandler(async (req, res) => {
  const { email } = req.body;

  try {
    // Check if the user exists
    const user = await prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User with this email does not exist.",
      });
    }

    // Update the user's deleted field to true
    await prisma.users.update({
      where: { email },
      data: { deleted: true },
    });

    res.status(200).json({
      status: "success",
      message: "Account has been successfully deleted.",
    });
  } catch (error) {
    console.error("Error deleting account:", error);
    res.status(500).json({
      status: "fail",
      message: "Failed to delete account.",
      error: error.message,
    });
  }
});
exports.getUsersNames = asyncHandler(async (req, res) => {
  try {
    const { caseId } = req.params;

    if (!caseId) {
      return res.status(400).json({ message: "Missing caseId parameter" });
    }

    // Query to find patient_id and doctor_id for the given case_id
    const caseData = await prisma.cases.findUnique({
      where: {
        id: parseInt(caseId),
      },
      select: {
        patient_id: true,
        doctor_id: true,
      },
    });

    if (!caseData) {
      return res
        .status(404)
        .json({ message: "No case found for the given case ID." });
    }

    const { patient_id, doctor_id } = caseData;

    // Fetch user_id for the patient
    const patientUser = await prisma.patients.findUnique({
      where: {
        id: patient_id,
      },
      select: {
        user_id: true,
      },
    });

    // Fetch user_id for the doctor
    const doctorUser = await prisma.doctors.findUnique({
      where: {
        id: doctor_id,
      },
      select: {
        user_id: true,
      },
    });

    const userIds = [patientUser?.user_id, doctorUser?.user_id].filter(Boolean); // Filter out null or undefined values

    if (userIds.length === 0) {
      return res
        .status(404)
        .json({ message: "No associated users found for the given case ID." });
    }

    // Fetch first_name and last_name for the associated user IDs
    const users = await prisma.users.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        role_id: true,
      },
    });
    const parsedUsers = users.map((user) => ({
      ...user,
      id: Number(user.id), // Convert the id field to a number
      role_id: Number(user.role_id),
    }));
    res.status(200).json({ parsedUsers });
  } catch (error) {
    console.error("Error fetching user names:", error);
    res.status(500).json({ message: "Failed to fetch user names" });
  }
});
exports.getDoctor = asyncHandler(async (req, res) => {
  const doctorDetails = await prisma.doctors.findUnique({
    where: { user_id: req.user.id },
  });

  if (!doctorDetails) {
    return new ErrorResponse("No doctor details found", 404).send(res);
  }

  const responseData = {
    speciality: doctorDetails.speciality,
    office_phone: doctorDetails.office_phone,
    address: doctorDetails.address,
    address_2: doctorDetails.address_2,
    city: doctorDetails.city,
    zip: doctorDetails.zip,
  };

  return new SuccessResponse(responseData).send(res);
});

exports.protect = asyncHandler(async (req, res, next) => {
  // Check if we're on a JWT-protected route.
  if (req.originalUrl.startsWith("/api/v1")) {
    // ----------- JWT Authentication -----------
    let token;
    if (req.headers.authorization) {
      token = req.headers.authorization.split(" ")[1];
    }
    if (!token) {
      throw new AccessTokenError("No token provided");
    }
    try {
      const decoded = jwt.verify(token, process.env.SECRET);
      if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
        throw new AccessTokenError("Token has expired");
      }
      const user = await prisma.users.findUnique({
        where: { id: decoded.userId },
        include: { role: true },
      });
      if (!user) {
        throw new UnauthorizedError("User not found");
      }
      // Normalize role to a string from the role object
      user.role = user.role.name;
      req.user = user;

      // Inject the authenticated user's ID into the CLS context
      const ns = cls.getNamespace("request-session");
      if (ns) {
        ns.set("userId", user.id);
      }
      return next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        throw new AccessTokenError("Token has expired");
      } else if (error.name === "JsonWebTokenError") {
        throw new AccessTokenError("Invalid token");
      } else {
        throw new AccessTokenError("Token verification failed");
      }
    }
  } else if (req.originalUrl.startsWith("/api/v2")) {
    // ----------- Session/Cookie Authentication -----------
    if (!req.session || !req.session.userId) {
      throw new UnauthorizedError("No session found, please login");
    }
    const userId = req.session.userId;
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { role: true },
    });
    if (!user) {
      throw new UnauthorizedError("Session user no longer exists");
    }
    // Normalize role to a string
    user.role = user.role.name;
    req.user = user;

    // Inject user ID into CLS context
    const ns = cls.getNamespace("request-session");
    if (ns) {
      ns.set("userId", user.id);
    }
    console.log("User authenticated:", req.user);
    return next();
  }
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    console.log("req.user.role", req.user.role, roles);
    if (!roles.includes(req.user.role)) {
      throw new UnauthorizedError(
        "You do not have permission to perform this action"
      );
    }
    next();
  };
};

exports.updatePassword = asyncHandler(async (req, res) => {
  const { id } = req.user; // Get user ID from authenticated user
  const user = await prisma.users.findUnique({ where: { id } });
  if (!user) {
    throw new NotFoundError("User not found");
  }
  if (!(await bcrypt.compare(req.body.currentPassword, user.password))) {
    throw new BadRequestError("Your current password is wrong");
  }
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(req.body.newPassword, salt);
  // Update user password
  await prisma.users.update({
    where: { id },
    data: {
      password: hashedPassword,
    },
  });

  return new SuccessMsgDataResponse("Password updated successfully").send(res);
});

exports.updateProfilePicture = asyncHandler(async (req, res) => {
  cpUpload(req, res, async (error) => {
    try {
      const file = req.files.profile_pic[0];
      const imageUrl = await uploadSingleFile(
        file,
        null,
        process.env.GOOGLE_STORAGE_BUCKET_PROFILE_PICS
      );

      // Determine the user ID to update based on the role of the requester
      const userIdToUpdate =
        req.user.role == "admin" ? req.body.user_id : req.user.id;

      // Check if userIdToUpdate is valid
      if (!userIdToUpdate) {
        throw new BadRequestError(
          "User ID is required for updating the profile picture."
        );
      }

      const user = await prisma.users.update({
        where: { id: userIdToUpdate },
        data: { profile_pic: imageUrl },
        include: {
          role: true,
        },
      });

      user.id = Number(user.id);
      user.role_id = Number(user.role_id);
      user.role = {};
      user.role.name = req.user.role;

      createSendToken(user, req, res);
    } catch (error) {
      console.error("Error updating profile picture: ", error);
      throw new BadRequestError("Error updating profile picture");
    }
  });
});

exports.updateMe = asyncHandler(async (req, res) => {
  try {
    const { id } = req.user;
    console.log("Updating user with ID:", id);
    req.body.phone = req.body.phone.replace(/\s+/g, "");
    console.log("Request body:", req.body);
    const existingUser = await prisma.users.findUnique({
      where: { id },
      include: {
        doctors: true, // Assuming there's a one-to-one relationship named 'doctors'
      },
    });

    if (!existingUser) {
      throw new BadRequestError("User not found");
    }
    // --- NEW LOGIC: Check for existing phone number before updating ---
    if (req.body.phone && existingUser.phone !== req.body.phone) {
      const phoneExists = await prisma.users.findUnique({
        where: { phone: req.body.phone },
      });

      if (phoneExists && phoneExists.id !== id) {
        // If a user with this phone exists AND it's not the current user, throw an error
        throw new BadRequestError("This phone number is already registered to another account.");
      }
    }
    // Invalidate email and phone verification if they have changed
    if (existingUser.email !== req.body.email) {
      req.body.email_verified = false;
    }
    if (existingUser.phone !== req.body.phone) {
      req.body.phone_verified = false;
    }

    // Update general user data
    const updatedUser = await prisma.users.update({
      where: { id },
      data: {
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        user_name: req.body.user_name,
        email: req.body.email,
        phone: req.body.phone,
        country: req.body.country,
        email_verified: req.body.email_verified,
        phone_verified: req.body.phone_verified,
      },
    });

    // Update doctor-specific data if the user is a doctor
    if (req.user.role === "doctor" && existingUser.doctors) {
      const doctorData = {
        speciality: req.body.speciality,
        office_phone: req.body.office_phone,
        address: req.body.address,
        address_2: req.body.address_2,
        city: req.body.city,
        zip: req.body.zip,
      };
      await prisma.doctors.update({
        where: { user_id: id },
        data: doctorData,
      });
    }

    // Clean up the response
    updatedUser.id = Number(updatedUser.id);
    updatedUser.role_id = Number(updatedUser.role_id);
    updatedUser.role = {
      name: req.user.role,
    };

    createSendToken(updatedUser, req, res);
  } catch (error) {
    console.log(error);
    throw new BadRequestError(error.message);
  }
});

async function sendPasswordResetEmail(user, resetToken) {
  const resetURL = `${process.env.CLIENT_URL}/forgot-password?token=${resetToken}&email=${user.email}`;

  const templatePath = "templates/email/reset-password.html"; // Provide the path to your HTML template
  const templateData = {
    resetURL: resetURL,
    email: user.email,
  };

  // Add the email task to the queue
  await queueEmail({
    emails: [user.email],
    subject: "Mot de passe oublié?",
    templatePath: templatePath,
    templateData: templateData,
  });
}

exports.forgotPassword = asyncHandler(async (req, res, next) => {
  const { email } = req.body;
  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) {
    throw new NotFoundError("There is no user with email address.");
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  await prisma.password_resets.upsert({
    where: { email },
    create: {
      email,
      token: resetToken,
      expiration_date: new Date(Date.now() + 10 * 60 * 1000),
    },
    update: {
      token: resetToken,
      expiration_date: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  try {
    await sendPasswordResetEmail(user, resetToken);
    return new SuccessMsgResponse(
      "Email has been sent, please check your inbox."
    ).send(res);
  } catch (err) {
    console.error("Email sending error:", err);
    throw new BadRequestError(
      "There was an error sending the email. Try again later!"
    );
  }
});

exports.resetPassword = asyncHandler(async (req, res, next) => {
  const { email, token, password, password_confirm } = req.body;

  if (password !== password_confirm) {
    throw new BadRequestError("Passwords do not match");
  }

  const reset = await prisma.password_resets.findUnique({
    where: { email, token },
  });

  if (!reset || reset.expiration_date < new Date()) {
    throw new BadRequestError("Token is invalid or has expired");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  await prisma.users.update({
    where: { email },
    data: { password: hashedPassword },
  });

  await prisma.password_resets.delete({ where: { email } });

  const templatePath = "templates/email/password-reset.html";

  await queueEmail({
    emails: [email],
    subject: "Password reset successful",
    templatePath: templatePath,
  });

  return new SuccessMsgResponse("Password reset successful").send(res);
});

exports.firebaseCallback = async (req, res, next) => {
  try {
    const defaultAuth = getAuth(); // Initialize defaultAuth here

    const { id, phone } = req.body;

    // Validate input
    if (!phone) {
      throw new Error("Phone number is required");
    }

    const userRecord = await defaultAuth.getUserByPhoneNumber(phone);

    if (!userRecord) {
      throw new Error("User not found with the provided phone number");
    }

    // Normalize phone numbers: remove '+' prefix from Firebase phone number
    const firebasePhoneNumber = userRecord.phoneNumber;

    // Normalize phone number from Prisma users (remove spaces)
    const normalizedPhoneNumber = phone.replace(/\s+/g, "");

    // Find user by normalized Firebase phone number
    const user = await prisma.users.findUnique({
      where: {
        phone: normalizedPhoneNumber,
      },
      include: { role: true },
    });
    user.id = Number(user.id);
    user.role_id = Number(user.role_id);

    if (user && user.phone.replace(/\s+/g, "") === firebasePhoneNumber) {
      createSendTokenMobile(user, req, res);
    } else {
      throw new Error(
        "User not found in Prisma with the provided phone number"
      );
    }
  } catch (error) {
    console.log(error);
    return next(new BadRequestError(error.message));
  }
};

/* exports.firebaseCallback = async (req, res, next) => {
  try {
    const defaultAuth = getAuth();

    const { uuid, phone } = req.body;

    // Validate input
    if (!phone) {
      throw new Error("Phone number is required");
    }

    if (!uuid) {
      throw new Error("uuid is required");
    }

    const normalizedPhoneNumber = phone.replace(/\s+/g, "");

    // Find user in Firebase Auth by phone number
    const userRecord = await defaultAuth.getUserByPhoneNumber(normalizedPhoneNumber);

    if (!userRecord) {
      throw new Error("User not found with the provided phone number");
    }

    // Find user in MySQL by Firebase UID
    const user = await prisma.users.findUnique({
      where: {
        phone: userRecord.phone,
        firebase_uuid: uuid,
      },
      include: { role: true }
    });

    if (user) {
      // Ensure phone number matches
      const mysqlPhoneNumber = user.phone.replace(/\s+/g, '');
      if (mysqlPhoneNumber === normalizedPhoneNumber) {
        user.id = Number(user.id);
        user.role_id = Number(user.role_id);
        createSendTokenMobile(user, req, res, true);
      } else {
        throw new Error("Data mismatch");
      }
    } else {
      throw new Error("User not found");
    }
  } catch (error) {
    console.log(error);
    return next(new BadRequestError(error.message));
  }
}; */

// Function to send a verification code via SMS
exports.sendPhoneVerification = async (req, res, next) => {
  try {
    let { phone } = req.body;
    phone = phone.replace(/\s+/g, ""); // Remove spaces from phone number

    let authenticated = false;
    let user;

    // Extract the token from the Authorization header
    const token = req.headers.authorization
      ? req.headers.authorization.split(" ")[1]
      : null;

    if (token) {
      const decoded = jwt.verify(token, tokenInfo.secret);
      user = await prisma.users.findUnique({
        where: { id: decoded.userId },
        include: {
          role: true,
        },
      });

      if (!user) {
        throw new UnauthorizedError(
          "The user belonging to this token does not exist."
        );
      }

      authenticated = true;
      user.role = user.role.name;
      req.user = user;

      // Check if the phone number is in use by another user only if authenticated
      const existingUserWithPhone = await prisma.users.findUnique({
        where: {
          phone: phone,
        },
      });

      if (existingUserWithPhone && req.user.id !== existingUserWithPhone.id) {
        return res.status(409).json({
          message: "Phone number already in use by another account.",
        });
      }
    }

    // Proceed with sending verification code through Twilio
    const verification = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: phone, channel: "sms" });

    res.status(200).json({
      message: "Verification code sent successfully.",
      status: verification.status,
    });
  } catch (error) {
    console.error("Error sending verification code: ", error);
    let errorMessage = "Failed to send verification code.";
    if (error instanceof UnauthorizedError) {
      errorMessage = error.message;
    }
    res.status(400).json({ message: errorMessage, error: error.message });
  }
};

// exports.verifyPhoneNumber = async (req, res, next) => {
//     try {
//         const { phone, code, two_factor_status } = req.body;
//         const user = req.user;

//         // Perform verification check with Twilio
//         const verification_check = await client.verify.v2.services(process.env.TWILIO_SERVICE_SID)
//             .verificationChecks
//             .create({ to: phone, code: code });

//         if (verification_check.status === "approved") {
//             // Update the user in the database with the phone number and verification status
//             await prisma.users.update({
//                 where: { id: user.id },
//                 data: {
//                     phone: phone,
//                     phone_verified: true,
//                     two_factor_enabled: two_factor_status
//                 }
//             });

//             // Send a success response
//             return res.status(200).json({
//                 message: "Phone number verified successfully.",
//                 status: verification_check.status
//             });
//         } else {
//             // Send an error response if verification is not approved
//             return res.status(400).json({
//                 message: "Invalid verification code."
//             });
//         }
//     } catch (error) {
//         console.error("Error checking verification code: ", error);
//         return res.status(500).json({
//             message: "Failed to check verification code.",
//             error: error.message
//         });
//     }
// }

exports.verifyPhoneNumber = async (req, res, next) => {
  try {
    const { phone, code } = req.body;
    const user = req.user;

    // Perform verification check with Twilio
    const verification_check = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: phone, code: code });

    if (verification_check.status === "approved") {
      // Check if the phone number already exists for a different user
      const existingUserWithPhone = await prisma.users.findUnique({
        where: { phone: phone },
      });

      if (existingUserWithPhone && existingUserWithPhone.id !== user.id) {
        return res.status(409).json({
          message: "Phone number already in use by another account.",
        });
      }

      // Retrieve the existing user's data from the database
      const currentUser = await prisma.users.findUnique({
        where: { id: user.id },
      });

      if (!currentUser) {
        return res.status(404).json({
          message: "User not found.",
        });
      }

      // Invert the two_factor_enabled value based on the current state
      const newTwoFactorStatus = !currentUser.two_factor_enabled;

      // Update the user with the new phone number and inverted two-factor status
      const updatedUser = await prisma.users.update({
        where: { id: user.id },
        data: {
          phone: phone,
          phone_verified: true,
          two_factor_enabled: newTwoFactorStatus,
        },
      });

      // Normalize IDs and set the user's role information
      updatedUser.id = Number(updatedUser.id);
      updatedUser.role_id = Number(updatedUser.role_id);
      updatedUser.role = {};
      updatedUser.role.name = req.user.role;

      // Send the updated user details using the `createSendTokenMobile` function
      createSendTokenMobile(updatedUser, req, res);
    } else {
      // Send an error response if verification is not approved
      return res.status(400).json({
        message: "Invalid verification code.",
      });
    }
  } catch (error) {
    console.error("Error checking verification code: ", error);
    return res.status(500).json({
      message: "Failed to check verification code.",
      error: error.message,
    });
  }
};

exports.sendEmailVerificationCode = async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    // Generate a unique token for verification
    const token = crypto.randomBytes(20).toString("hex");
    const expirationDate = new Date(Date.now() + 3600000); // Token expires in 1 hour

    // Delete any existing verification code for this email
    await prisma.email_verification_codes.deleteMany({
      where: {
        email: email,
      },
    });

    // Save the new token and email in the database
    await prisma.email_verification_codes.create({
      data: {
        email,
        token,
        expiration_date: expirationDate,
      },
    });
    const templatePath = "templates/email/mail-verif.html"; // Provide the path to your HTML template
    const templateData = {
      token,
    };
    await queueEmail({
      emails: [email],
      subject: "Vérifiez votre e-mail",
      templatePath: templatePath,
      templateData: templateData,
    });

    res.status(200).json({ message: "Verification email sent successfully." });
  } catch (err) {
    console.error("Error sending email verification code: ", err);
    res.status(500).json({
      message: "Failed to send email verification code.",
      error: err.message,
    });
  }
};

exports.verifyEmailCode = async (req, res) => {
  const { code, email } = req.body;
  if (!code || !email) {
    return res.status(400).json({ message: "Code and email are required." });
  }

  try {
    // Retrieve the verification record from the database
    const verificationRecord = await prisma.email_verification_codes.findUnique(
      {
        where: {
          email,
        },
      }
    );

    // Check if the token is valid and has not expired
    if (
      !verificationRecord ||
      verificationRecord.token !== code ||
      new Date() > new Date(verificationRecord.expiration_date)
    ) {
      return res.status(400).json({ message: "Invalid or expired Code." });
    }

    // Update the user's email verification status in the database
    const newUser = await prisma.users.update({
      where: { email },
      data: { email_verified: true },
    });

    // Optionally, delete the verification record from the database
    await prisma.email_verification_codes.delete({
      where: { id: verificationRecord.id },
    });

    newUser.id = Number(newUser.id);
    newUser.role_id = Number(newUser.role_id);
    newUser.role = {};
    newUser.role.name = req.user.role;

    createSendTokenMobile(newUser, req, res);
  } catch (err) {
    console.error("Error verifying email code: ", err);
    res
      .status(500)
      .json({ message: "Failed to verify email.", error: err.message });
  }
};

exports.sendOTP = async (req, res) => {
  try {
    const { phoneNumber, role, id } = req.body; // Extract phone number, role, and id

    // Fetch the user based on phone number
    const user = await prisma.users.findUnique({
      where: { phone: phoneNumber },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User with the provided phone number does not exist.",
      });
    }

    // Check if has_mobile_account is false (0)
    if (!user.has_mobile_account) {
      // If user does not have a mobile account, create one using the provided logic

      const roleLowered = role ? role.toLowerCase() : "";
      if (!id || !roleLowered) {
        return res.status(400).json({
          message: "Missing required field: id or role.",
        });
      }
      if (roleLowered !== "agent" && roleLowered !== "customer") {
        return res.status(400).json({
          message: "Invalid user type.",
        });
      }

      // Parse the phone number to get country code and raw number
      const parsedPhone = parsePhoneNumberFromString(user.phone);
      if (!parsedPhone) {
        return res.status(400).json({
          message: "Invalid phone number.",
        });
      }

      const countryCode = `+${parsedPhone.countryCallingCode}`;
      const rawPhone = parsedPhone.nationalNumber;
      const photoUrl = user.profile_pic || "";

      // Create the mobile user
      const result = await createMobileUserUtils({
        id,
        nickname: `${user.first_name} ${user.last_name}`,
        phone: rawPhone,
        phoneWithCountryCode: user.phone,
        countryCode,
        photoUrl,
        roleLowered,
      });

      if (result.success) {
        // Update `has_mobile_account` in the `users` table
        await prisma.users.update({
          where: { id: parseInt(id) },
          data: { has_mobile_account: true },
        });

        return res.status(201).json({
          success: true,
          message: `${role} created successfully and OTP sent.`,
          agentId: result.id,
        });
      } else {
        return res.status(500).json({
          success: false,
          message: "Failed to create mobile account.",
          error: result.error,
        });
      }
    }

    // If mobile account exists, send the OTP via Twilio
    const verification = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verifications.create({ to: phoneNumber, channel: "sms" });

    return res
      .status(200)
      .json({ success: true, message: "OTP sent", verification });
  } catch (error) {
    console.error("Error sending OTP or creating mobile account:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP or create mobile account.",
      error: error.message,
    });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otpCode } = req.body;

    const verificationCheck = await client.verify.v2
      .services(process.env.TWILIO_SERVICE_SID)
      .verificationChecks.create({ to: phoneNumber, code: otpCode });

    if (verificationCheck.status === "approved") {
      // Generate a Firebase custom token (or complete your login logic)
      const firebaseToken = await admin.auth().createCustomToken(phoneNumber);

      return res
        .status(200)
        .json({ success: true, firebaseToken, message: "OTP verified" });
    }

    res.status(400).json({ success: false, message: "Invalid OTP" });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to verify OTP",
      error: error.message,
    });
  }
};

exports.createSendTokenMobile = createSendTokenMobile;
