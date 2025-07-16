// routes/contact.js
const express = require('express');
const router = express.Router();
const contactController = require('../../controllers/contactController'); // Path to your controller

// Route 1: Handle sending a consultation request message and creating a doctor's calendar event
// This is the primary route for the contact form on the doctor's profile page.
router.post('/doctor', contactController.contactDoctorAndCreateCalendarEvent);

// Route 2: Initiate Google Calendar OAuth for a doctor to link their calendar
// This route generates the URL for the doctor to grant your application calendar access.
// It's typically accessed from the doctor's authenticated dashboard/settings.
router.get('/google/auth-url', contactController.initiateDoctorGoogleCalendarAuth);

// Route 3: Handle the callback from Google after a doctor grants calendar permissions
// Google redirects to this URL after the doctor authorizes your application.
// This route exchanges the authorization code for access/refresh tokens and stores them.
router.get('/google/callback', contactController.handleDoctorGoogleCalendarCallback);

module.exports = router;