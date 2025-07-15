const Joi = require("joi");
const { JoiObjectId } = require("../../../middlewares/schemaValidator");

exports.createUser = Joi.object({
  name: Joi.string().trim().min(3).max(30).required(),
  lastName: Joi.string().trim().min(3).max(30).required(),
  email: Joi.string().min(3).required().email(),
  password: Joi.string().min(8).required().regex(/^[a-zA-Z0-9]{8,30}$/),
  passwordConfirm: Joi.string().min(8).required().valid(Joi.ref('password')).regex(/^[a-zA-Z0-9]{8,30}$/),
  phone: Joi.string().length(8).required(),
  profilePicture: Joi.string().min(3).required()

});
exports.updateUser = Joi.object({
  first_name: Joi.string().trim().min(3).max(30).required(),
  last_name: Joi.string().trim().min(3).max(30).required(),
  user_name: Joi.string().min(3).required(),
  email: Joi.string().min(3).email().required(),
  phone: Joi.string().required(),
  country: Joi.string().length(2).required(),
  speciality: Joi.string().valid('Omnipratic', 'Orthodontist', 'Oral surgeon', 'Student').required(),
  address: Joi.string().required(),
  address_2: Joi.any(),
  city: Joi.string().required(),
  zip: Joi.string().required(),
  office_phone: Joi.string().required()
});

exports.getUsers = Joi.object({
  name: Joi.string().trim().min(3).max(30).optional(),
  lastName: Joi.string().trim().min(3).max(30).optional(),
  email: Joi.string().min(3).optional().email(),
  phone: Joi.string().optional(),
  profilePicture: Joi.string().min(3).optional(),
  deleted: Joi.boolean().optional(),
  page: Joi.number().optional(),
  perPage: Joi.number().optional(),
  search: Joi.string().optional(),
  sort: Joi.string().optional()

})
exports.checkUserId = Joi.object({
  id: Joi.string().required()
})

exports.forgetPassword = Joi.object({
  email: Joi.string().required()
})

exports.resetPasswordToken = Joi.object({
  token: Joi.string().required()
})

exports.resetPassword = Joi.object({
  password: Joi.string().min(8).regex(/^[a-zA-Z0-9]{8,30}$/).required(),
  passwordConfirm: Joi.string().min(8).valid(Joi.ref('password')).regex(/^[a-zA-Z0-9]{8,30}$/).required()
})

exports.createDoctor = Joi.object({
  first_name: Joi.string().trim().min(3).max(30).required(),
  last_name: Joi.string().trim().min(3).max(30).required(),
  email: Joi.string().trim().required().email(),
  password: Joi.string().min(6).required(),
  password_confirm: Joi.string().min(6).required().valid(Joi.ref('password')),
  phone: Joi.string().min(8).required(),
  office_phone: Joi.string().min(8).required(),
  speciality: Joi.string().valid('Omnipratic', 'Orthodontist', 'Oral surgeon', 'Student').required(),
  address: Joi.string().required(),
  address_2: Joi.string(),
  city: Joi.string().required(),
  zip: Joi.string().required(),
  country: Joi.string().required(),
  profile_picture: Joi.any(), // Handling file upload
  is_agreed: Joi.boolean().required()
});