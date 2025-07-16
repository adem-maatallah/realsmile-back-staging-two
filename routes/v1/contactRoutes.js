// routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const contactController = require('../../controllers/contactController'); // Path to your controller
const authController = require('../../controllers/authController'); // Needed for protect and restrictTo middleware

// Public route: Handle sending a consultation request message and creating a doctor's calendar event
router.post('/doctor', contactController.requestConsultation);

// Doctor-specific route: Initiate Google Calendar OAuth for a doctor to link their calendar
// This route should be protected and restricted to 'doctor' role.
router.get(
  '/google/initiate-calendar-link',
  authController.protect,           // Ensures user is logged in
  authController.restrictTo('doctor'), // Ensures only doctors can access this
  contactController.initiateDoctorGoogleCalendarAuth
);

// Public route: Handle the callback from Google after a doctor grants calendar permissions
// Google redirects to this URL, so it must be public (no auth middleware).
router.get('/google/callback', contactController.handleDoctorGoogleCalendarCallback);

module.exports = router;