const Joi = require("joi");

exports.signup = Joi.object().keys({
  first_name: Joi.string().min(3).max(30).required(),
  last_name: Joi.string().min(3).max(30).required(),
  user_name: Joi.string().min(3).max(30).required(),
  email: Joi.string().min(3).required().email(),
  password: Joi.string().min(8).required().regex(/^[a-zA-Z0-9]{8,30}$/),
  passwordConfirm: Joi.string().min(8).required().valid(Joi.ref('password')).regex(/^[a-zA-Z0-9]{8,30}$/),
  phone: Joi.string().length(8).required(),
  specialty: Joi.string().min(3).required(),
});

exports.login = Joi.object({
  email: Joi.string().min(3).required().email(),
  password: Joi.string().min(4).required(),
  rememberMe: Joi.boolean().optional(),
  captchaToken: Joi.string().optional(),
  isMobileApp: Joi.boolean().optional(),
});

exports.sendOtp = Joi.object({
  phoneNumber: Joi.string().required(),
});

exports.verifyOTP = Joi.object({
  phoneNumber: Joi.string().required(),
  otpCode: Joi.string().length(6).required(),
});

exports.loginSms = Joi.object({
  phone: Joi.string().required(),
  otp: Joi.string().length(6).required(),
  id: Joi.number()
})

exports.updatePassword = Joi.object().keys({
  currentPassword: Joi.string().required().regex(/^[a-zA-Z0-9]{8,30}$/),
  newPassword: Joi.string().min(8).required().regex(/^[a-zA-Z0-9]{8,30}$/),
  newPasswordConfirm: Joi.string().min(8).required().valid(Joi.ref('newPassword')).regex(/^[a-zA-Z0-9]{8,30}$/)
})
exports.checkoutSchema = Joi.object({
  payment_token: Joi.string().required(),
  transaction: Joi.string().required()
})

exports.updateMe = Joi.object().keys({
  name: Joi.string().trim().min(3).max(30).optional(),
  lastName: Joi.string().trim().min(3).max(30).optional(),
  phone: Joi.string().length(8).optional(),
  profilePicture: Joi.string().min(3).optional(),
  email: Joi.string().email().optional()
})

