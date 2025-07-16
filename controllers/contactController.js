const { PrismaClient } = require("@prisma/client");
const { google } = require('googleapis');
const asyncHandler = require("express-async-handler");
const queueEmail = require("../utils/email"); // Ensure this path is correct for your project structure

const prisma = new PrismaClient();

// Configure Google OAuth2 client
// These environment variables MUST be set in your .env file
// and match your Google Cloud Project's OAuth 2.0 Client ID settings.
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI // e.g., http://localhost:5000/api/contact/google/callback
);

// Helper to handle BigInt serialization for JSON (if not already globally configured)
// Not strictly needed in controller if safeBigIntToNumber is only used on response data,
// but good to keep in mind if BigInts flow directly to/from API.

// Route to initiate Google Calendar OAuth for a doctor
// This endpoint generates the URL that a doctor needs to visit to grant calendar access.
// It should be protected so only authenticated doctors can access it.
exports.initiateDoctorGoogleCalendarAuth = asyncHandler(async (req, res) => {
    // In a real application, you'd associate this auth request with the logged-in doctor's ID.
    // For simplicity here, we might pass it as 'state' if the doctor is not logged into an API that provides their ID.
    // Assuming req.user.id exists if this route is protected by auth middleware.
    if (!req.user || !req.user.id) { // Example check for authenticated user
        return res.status(401).json({ message: "Authentication required to link calendar." });
    }
    const doctorUserId = req.user.id; // Get ID of the doctor initiating the auth

    const scopes = ['https://www.googleapis.com/auth/calendar.events']; // Scope for creating calendar events
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Request a refresh token (important for long-term access)
        scope: scopes,
        prompt: 'consent', // Ensures the consent screen is always shown to get refresh token
        state: JSON.stringify({ userId: doctorUserId }), // Pass user ID to retrieve it in the callback
    });
    res.json({ authUrl });
});

// Route to handle the callback from Google after a doctor grants calendar permissions
// Google redirects to this URL with an authorization code.
exports.handleDoctorGoogleCalendarCallback = asyncHandler(async (req, res) => {
    const { code, state } = req.query; // 'code' is the auth code, 'state' is what we passed previously

    if (!code) {
        console.error('Google OAuth callback: No code received.');
        return res.redirect(`${process.env.FRONTEND_URL}/doctor/settings?calendarLinked=false&error=no_code`);
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        const { userId } = JSON.parse(state); // Retrieve the doctor's user ID from the state

        // Securely save tokens (especially refresh_token) for this doctor in your database.
        // You would likely add a 'googleCalendarRefreshToken' field to your 'users' model.
        await prisma.users.update({
            where: { id: BigInt(userId) },
            data: {
                googleCalendarRefreshToken: tokens.refresh_token, // Store this securely!
                // Optionally store access_token and expiry_date if needed immediately,
                // but refresh_token is key for long-term offline access.
            }
        });

        console.log(`Doctor ${userId} successfully linked Google Calendar.`);
        res.redirect(`${process.env.FRONTEND_URL}/doctor/settings?calendarLinked=true`); // Redirect back to doctor's settings
    } catch (error) {
        console.error('Error handling doctor Google Calendar callback:', error);
        res.redirect(`${process.env.FRONTEND_URL}/doctor/settings?calendarLinked=false&error=auth_failed&details=${error.message}`);
    }
});


// Main endpoint to handle client consultation requests, send email, and create calendar event
exports.contactDoctorAndCreateCalendarEvent = asyncHandler(async (req, res) => {
    const { toDoctorId, clientFirstName, clientLastName, clientEmail, clientPhone, consultationDate, clientMessage } = req.body;

    // 1. Validate Inputs
    if (!toDoctorId || !clientFirstName || !clientLastName || !clientEmail || !clientPhone || !consultationDate || !clientMessage) {
        return res.status(400).json({ message: "Tous les champs du formulaire sont obligatoires." });
    }

    // Server-side validation for consultation date (redundant but good practice)
    const parsedConsultationDate = new Date(consultationDate);
    const now = new Date();
    // Check if the date is valid AND in the future
    if (isNaN(parsedConsultationDate.getTime()) || parsedConsultationDate <= now) {
        return res.status(400).json({ message: "La date et l'heure de consultation doivent être valides et dans le futur." });
    }

    try {
        // 2. Find Doctor's Details and Calendar Refresh Token
        const doctor = await prisma.doctors.findUnique({
            where: { user_id: BigInt(toDoctorId) },
            include: { user: true } // Ensure to include the related user data
        });

        if (!doctor || !doctor.user || !doctor.user.email) {
            return res.status(404).json({ message: "Médecin introuvable ou n'a pas d'email de contact." });
        }

        const doctorEmail = doctor.user.email;
        const doctorFullName = `${doctor.user.first_name || ''} ${doctor.user.last_name || ''}`.trim();
        // Retrieve the stored Google Calendar refresh token for this doctor
        const doctorGoogleCalendarRefreshToken = doctor.user.googleCalendarRefreshToken;

        // 3. Send Email to Doctor
        const emailSubject = `Nouvelle demande de consultation de ${clientFirstName} ${clientLastName}`;
        const emailHtml = `
            <p>Bonjour Dr. ${doctorFullName},</p>
            <p>Vous avez reçu une nouvelle demande de consultation via votre profil Realsmile.</p>
            <p><strong>Détails du patient:</strong></p>
            <ul>
                <li><strong>Nom complet:</strong> ${clientFirstName} ${clientLastName}</li>
                <li><strong>Email:</strong> <a href="mailto:${clientEmail}">${clientEmail}</a></li>
                <li><strong>Téléphone:</strong> <a href="tel:${clientPhone}">${clientPhone}</a></li>
                <li><strong>Date et heure souhaitées:</strong> ${parsedConsultationDate.toLocaleString('fr-FR')}</li>
            </ul>
            <p><strong>Message du patient:</strong></p>
            <blockquote style="border-left: 4px solid ${process.env.DEFAULT_PRESET_COLORS_DEFAULT || '#d39424'}; margin: 0; padding: 0 15px; color: #555;">
                <p>${clientMessage}</p>
            </blockquote>
            <p>Veuillez contacter ce patient pour confirmer ou reprogrammer la consultation.</p>
            <p>Cordialement,</p>
            <p>L'équipe Realsmile</p>
        `;

        await queueEmail({
            emails: [doctorEmail],
            subject: emailSubject,
            html: emailHtml,
        });
        console.log(`Email sent to doctor ${doctorEmail}`);


        // 4. Create Google Calendar Event for the Doctor (if linked)
        let calendarEventLink = null;
        if (doctorGoogleCalendarRefreshToken) {
            // Set the doctor's refresh token to the OAuth2 client
            oauth2Client.setCredentials({
                refresh_token: doctorGoogleCalendarRefreshToken,
            });

            // Get a new access token using the refresh token (refresh tokens don't expire, access tokens do)
            const { credentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(credentials); // Update the client with the new access token

            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

            const eventStartTime = parsedConsultationDate;
            const eventEndTime = new Date(parsedConsultationDate.getTime() + 30 * 60 * 1000); // Default 30-minute consultation

            // Get server's current timezone or use a default
            const serverTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';

            const event = {
                summary: `Consultation avec ${clientFirstName} ${clientLastName}`,
                location: `${doctor.address || ''}, ${doctor.city || ''}, ${doctor.country || ''}`.trim() || 'Cabinet médical',
                description: `Demande de consultation via Realsmile.\n\n` +
                             `Patient: ${clientFirstName} ${clientLastName}\n` +
                             `Email: ${clientEmail}\n` +
                             `Téléphone: ${clientPhone}\n` +
                             `Message du patient: "${clientMessage}"\n\n` +
                             `Merci de confirmer ou reprogrammer avec le patient.`,
                start: {
                    dateTime: eventStartTime.toISOString(), // ISO string is preferred for consistency
                    timeZone: serverTimeZone,
                },
                end: {
                    dateTime: eventEndTime.toISOString(),
                    timeZone: serverTimeZone,
                },
                attendees: [
                    { 'email': doctorEmail }, // Doctor is the primary attendee
                    // Consider if you want the patient directly invited to the doctor's calendar event.
                    // This is usually optional and needs patient's explicit consent to share their email for invite.
                    // { 'email': clientEmail, responseStatus: 'tentative' }
                ],
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 24 * 60 }, // 24 hours before
                        { method: 'popup', minutes: 60 },    // 1 hour before
                    ],
                },
                colorId: '4', // A standard Google Calendar color ID (e.g., '4' for green, '1' for blue, '2' for green, '3' for purple, etc.)
            };

            const createdEvent = await calendar.events.insert({
                calendarId: 'primary', // Use 'primary' for the user's (doctor's) primary calendar
                resource: event,
            });

            console.log('Google Calendar event created for doctor:', createdEvent.data.htmlLink);
            calendarEventLink = createdEvent.data.htmlLink;

        } else {
            console.warn(`Doctor ${doctor.user.email} has not linked their Google Calendar. Event not created.`);
            // You might inform the frontend about this via a different success message or a warning toast.
        }

        // 5. Respond to Frontend
        res.status(200).json({
            message: "Demande de consultation envoyée au médecin. Un événement a été ajouté à son calendrier Google si lié.",
            calendarEventLink: calendarEventLink // Send the event link back if successfully created
        });

    } catch (error) {
        console.error("Error in contactDoctorAndCreateCalendarEvent:", error);
        // More specific error messages could be crafted here based on 'error.code' or 'error.response'
        res.status(500).json({
            message: "Échec de l'envoi de la demande de consultation. Une erreur est survenue lors de l'opération.",
            error: error.message // Sending back error message for debugging
        });
    }
});

// ///////////////////////////////////////////////////////////////////////////
// Place the initiateDoctorGoogleCalendarAuth and handleDoctorGoogleCalendarCallback
// functions here if they are part of the same contactController.js file.
// (As provided in the previous answer, these are for the doctor's side of things)
// ///////////////////////////////////////////////////////////////////////////

// Example: Route to initiate Google Calendar connection for a doctor
// (This would be part of a doctor's settings/profile management, not the public contact form)
exports.initiateDoctorGoogleCalendarAuth = asyncHandler(async (req, res) => {
    // In a real app, ensure this route is protected so only logged-in doctors can initiate.
    // For this example, let's assume `req.user.id` is available from authentication middleware.
    if (!req.user || !req.user.id) {
        return res.status(401).json({ message: "Authentication required to link calendar." });
    }
    const doctorUserId = req.user.id;

    const scopes = ['https://www.googleapis.com/auth/calendar.events'];
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Request a refresh token
        scope: scopes,
        prompt: 'consent', // Always show consent screen to ensure refresh token is granted
        state: JSON.stringify({ userId: doctorUserId }) // Pass user ID to retrieve it in callback
    });
    res.json({ authUrl });
});

// Example: OAuth Callback for Doctors
// (This is the endpoint Google redirects to after a doctor grants permission)
exports.handleDoctorGoogleCalendarCallback = asyncHandler(async (req, res) => {
    const { code, state } = req.query; // 'code' is the auth code, 'state' is what we passed previously

    if (!code) {
        console.error('Google OAuth callback: No code received.');
        // Redirect to a frontend page indicating error
        return res.redirect(`${process.env.FRONTEND_URL}/doctor/settings?calendarLinked=false&error=no_code`);
    }

    let userIdFromState;
    try {
        userIdFromState = JSON.parse(state).userId;
    } catch (e) {
        console.error('Invalid state parameter in Google OAuth callback:', e);
        return res.redirect(`${process.env.FRONTEND_URL}/doctor/settings?calendarLinked=false&error=invalid_state`);
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        // Securely save tokens (especially refresh_token) for this doctor in your DB
        await prisma.users.update({
            where: { id: BigInt(userIdFromState) },
            data: {
                googleCalendarRefreshToken: tokens.refresh_token, // Store this securely!
                // For direct API calls, you might store access_token and expiry as well,
                // but for background operations, refresh_token is sufficient.
            }
        });

        console.log(`Doctor ${userIdFromState} successfully linked Google Calendar.`);
        // Redirect back to the doctor's settings page
        res.redirect(`${process.env.FRONTEND_URL}/doctor/settings?calendarLinked=true`);
    } catch (error) {
        console.error('Error handling doctor Google Calendar callback:', error);
        res.redirect(`${process.env.FRONTEND_URL}/doctor/settings?calendarLinked=false&error=auth_failed&details=${error.message}`);
    }
});