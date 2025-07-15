const { default: rateLimit } = require("express-rate-limit");
const authController = require("../../controllers/authController");
const { schemaValidator } = require("../../middlewares/schemaValidator");
const { signup, loginSms, login, verifyOTP, sendOtp } = require("./schemas/authSchemas");
const express = require("express");
const router = express.Router();
const uploadToGoogleCloud = require("../../middlewares/fileUpload"); // Multer middleware
const { hasAnyRole } = require("../../middlewares/roleMiddleware");
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 5 login attempts per `window` per 15 minutes
  handler: (req, res /*next*/) => {
    res.status(429).json({
      message: "Trop de tentatives de connexion. Veuillez réessayer plus tard.",
    });
  },
  headers: true,
  trustProxy: true,
});

const requestLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 5 login attempts per `window` per 15 minutes
  handler: (req, res /*next*/) => {
    res.status(429).json({
      message: "Trop de tentatives. Veuillez réessayer plus tard.",
    });
  },
  headers: true,
  trustProxy: true,
});

router.post("/register", schemaValidator(signup), authController.signUp);

router.post(
  "/login",
  loginLimiter,
  // schemaValidator(login),
  authController.loginPatient
);

router.post(
  "/loginDoctor",
  loginLimiter,
  schemaValidator(login),
  authController.loginDoctor
);


router.post("/send-login-otp", loginLimiter, authController.sendLoginOtp);

router.post("/verify-login-otp", loginLimiter, authController.verifyLoginOtp);

router.post(
  "/sendOTP",
  loginLimiter,
  schemaValidator(sendOtp),
  authController.sendOTP
);

router.post(
  "/verifyOTP",
  loginLimiter,
  schemaValidator(verifyOTP),
  authController.verifyOTP
);

router.post(
  "/refreshToken",
  authController.protect,
  authController.refreshToken
);

router.post(
  "/sendPhoneVerification",
  requestLimiter,
  authController.sendPhoneVerification
);
router.post(
  "/login-sms",
  loginLimiter,
  schemaValidator(loginSms),
  authController.loginSms
);

router.put(
  "/verifyPhoneNumber",
  authController.protect,
  authController.verifyPhoneNumber
);
router.post(
  "/sendEmailVerificationCode",
  requestLimiter,
  authController.protect,
  authController.sendEmailVerificationCode
);
router.put(
  "/verifyEmailCode",
  authController.protect,
  authController.verifyEmailCode
);

router.patch(
  "/delete-account",
  authController.deleteAccount
);

router.route("/me").get(authController.protect, authController.getMe);
router.get(
  "/user-names/:caseId",
  authController.protect,
  hasAnyRole([1, 3, 4]),
  authController.getUsersNames
);

router.route("/doctor").get(authController.protect, authController.getDoctor);

router.route("/updateMyPassword").put(
  authController.protect,
  /* schemaValidator(updatePassword), */
  authController.updatePassword
);

router.route("/updateMe").put(
  authController.protect,
  /* schemaValidator(updateMe), */
  authController.updateMe
);

router.route("/updateProfilePic").put(
  authController.protect,
  /* schemaValidator(upd
      ateMe), */
  authController.updateProfilePicture
);

router.post("/forgotPassword", authController.forgotPassword);

router.patch("/resetPassword", authController.resetPassword);

router.post("/firebase/callback", authController.firebaseCallback);


// logout
router.post("/logout", authController.logout);
module.exports = router;

router.get("/check-qr-code/:qr_code", authController.checkQrCode);

router.get("/get-doctor-info/:qr_code", authController.getDoctorData);

router.post("/signUp", uploadToGoogleCloud, authController.signUpPatient);

router.post(
  "/signUpUnassigned",
  uploadToGoogleCloud,
  authController.signUpUnassigned
);