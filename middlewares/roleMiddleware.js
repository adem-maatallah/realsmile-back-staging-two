const asyncHandler = require("express-async-handler");

// Middleware to verify if the user is a manager
exports.isManager = asyncHandler(async (req, res, next) => {
  // Check if user is available from the protect middleware
  if (!req.user) {
    throw new Error("User not authenticated");
  }
  console.log(req.user.role_id);
  // Check if the user's role_id is 7 (assuming this is the role ID for a manager)
  if (req.user.role_id !== BigInt(7)) {
    throw new Error(
      "Access denied. Only managers are allowed to perform this action."
    );
  }

  // Proceed to the next middleware or function if the user is a manager
  next();
});

// Middleware to verify if the user is a patient
exports.isPatient = asyncHandler(async (req, res, next) => {
  // Check if user is available from the protect middleware
  if (!req.user) {
    throw new Error("User not authenticated");
  }
  console.log(req.user.role_id);
  // Check if the user's role_id is 4 (assuming this is the role ID for a patient)
  if (req.user.role_id !== BigInt(4)) {
    throw new Error(
      "Access denied. Only patients are allowed to perform this action."
    );
  }

  // Proceed to the next middleware or function if the user is a patient
  next();
});

// Middleware to verify if the user is a doctor
exports.isDoctor = asyncHandler(async (req, res, next) => {
  // Check if user is available from the protect middleware
  if (!req.user) {
    throw new Error("User not authenticated");
  }
  console.log(req.user.role_id);
  // Check if the user's role_id is 3 (assuming this is the role ID for a doctor)
  if (req.user.role_id !== BigInt(3)) {
    throw new Error(
      "Access denied. Only doctors are allowed to perform this action."
    );
  }

  // Proceed to the next middleware or function if the user is a doctor
  next();
});

exports.hasRole = (requiredRole) => (req, res, next) => {
  if (req.session && req.session.role_id === requiredRole) {
    return next(); // User has the required role, proceed to the next middleware or route handler
  }
  return res.status(403).json({
    status: "fail",
    message: "Forbidden: You do not have permission to access this resource",
  });
};
exports.hasAnyRole = (roles) => (req, res, next) => {
  console.log(req.session);
  if (req.session && roles.includes(req.session.role_id)) {
    return next(); // User has one of the required roles
  }
  return res.status(403).json({
    status: "fail",
    message: "Forbidden: You do not have permission to access this resource",
  });
};
