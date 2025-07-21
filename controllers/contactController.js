// controllers/contactController.js
const { PrismaClient } = require("@prisma/client");
const { google } = require('googleapis');
const asyncHandler = require("express-async-handler");
const queueEmail = require("../utils/email"); // Make sure this path is correct for your project structure
const { BadRequestError, InternalError } = require("../middlewares/apiError"); // Assuming you have these

const prisma = new PrismaClient();

// Configure Google OAuth2 client
// These environment variables MUST be set in your .env file
// and match your Google Cloud Project's OAuth 2.0 Client ID settings.
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI // This is your backend's redirect URI for OAuth
);

/**
 * @desc Initiates Google Calendar OAuth flow for an authenticated doctor.
 * Doctor visits the returned authUrl to grant permissions.
 * @route GET /api/contact/google/initiate-calendar-link
 * @access Private (Doctor only, requires authentication)
 */
exports.initiateDoctorGoogleCalendarAuth = asyncHandler(async (req, res, next) => {
    // Ensure the user is authenticated and is a doctor
    // (Auth middleware should attach user info to req.user)
    // Your `authController.protect` middleware should populate `req.user`.
    // Then, `authController.restrictTo('doctor')` ensures only doctors reach here.
    if (!req.user || !req.user.id || req.user.role !== 'doctor') { // Assuming req.user.role is a string like 'doctor'
        throw new BadRequestError("Only authenticated doctors can link their calendar.");
    }
    const doctorUserId = req.user.id; // User ID is a BigInt, store as BigInt, pass as BigInt

    // Scopes required for creating and managing events in the doctor's calendar
    const scopes = ['https://www.googleapis.com/auth/calendar.events'];
console.log('--- DÉBOGAGE GOOGLE OAUTH ---');
    console.log('CLIENT_ID utilisé :', process.env.GOOGLE_CLIENT_ID);
    console.log('REDIRECT_URI utilisé :', process.env.GOOGLE_CALENDAR_REDIRECT_URI);
    console.log('-----------------------------');
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Request a refresh token (crucial for long-term offline access)
        scope: scopes,
        prompt: 'consent', // Always show consent screen to ensure refresh token is granted
        state: JSON.stringify({ userId: doctorUserId.toString() }), // Pass user ID as string for JSON safety
    });

    res.status(200).json({ authUrl });
});

/**
 * @desc Handles the callback from Google after a doctor grants calendar permissions.
 * Google redirects to this URL with an authorization code.
 * @route GET /api/contact/google/callback
 * @access Public (Google redirects here)
 */
// controllers/contactController.js

exports.handleDoctorGoogleCalendarCallback = asyncHandler(async (req, res, next) => {
    const { code, state } = req.query;

    console.log('--- Inside handleDoctorGoogleCalendarCallback ---');
    console.log('Received code:', code);
    console.log('Received state:', state);

    if (!code) {
        console.error('Error: No authorization code received.');
        return res.redirect(`${process.env.CLIENT_URL}/doctor/settings?calendarLinked=false&error=no_code`);
    }

    let userIdFromState;
    try {
        userIdFromState = JSON.parse(state).userId;
        console.log('Parsed userId from state:', userIdFromState);
    } catch (e) {
        console.error('Error parsing state:', e);
        return res.redirect(`${process.env.CLIENT_URL}/doctor/settings?calendarLinked=false&error=invalid_state`);
    }

    try {
        console.log('Attempting to exchange code for tokens...');
        const { tokens } = await oauth2Client.getToken(code);
        console.log('Successfully received tokens:', tokens);
        if (tokens.refresh_token) {
            console.log('Refresh Token received:', tokens.refresh_token);
        } else {
            console.warn('Warning: No refresh token in tokens object.');
        }

        if (!tokens.refresh_token) {
            console.error('Error: No refresh token received from Google.');
            return res.redirect(`${process.env.CLIENT_URL}/doctor/settings?calendarLinked=false&error=no_refresh_token`);
        }

        console.log('Attempting to update user in DB:', userIdFromState);
        await prisma.users.update({
            where: { id: BigInt(userIdFromState) }, // Make sure userIdFromState is convertible to BigInt
            data: {
                googleCalendarRefreshToken: tokens.refresh_token,
            },
        });
        console.log(`User ${userIdFromState} updated successfully in DB.`);

        console.log('Redirecting to frontend success URL...');
        res.redirect(`${process.env.CLIENT_URL}/profile-settings?calendarLinked=true`);
    } catch (error) {
        console.error('FATAL ERROR in handleDoctorGoogleCalendarCallback:', error.message);
        if (error.response && error.response.data) {
            console.error('Google API Error Response:', error.response.data);
        }
        console.log('Redirecting to frontend error URL...');
        res.redirect(`${process.env.CLIENT_URL}/profile-settings?calendarLinked=false&error=...`);
    }
});


/**
 * @desc Handles public client consultation requests, sends email to doctor,
 * and creates a Google Calendar event if the doctor has linked their calendar.
 * @route POST /api/contact/doctor
 * @access Public
 */
exports.requestConsultation = asyncHandler(async (req, res, next) => {
    const { toDoctorId, clientFirstName, clientLastName, clientEmail, clientPhone, consultationDate, clientMessage } = req.body;

    // 1. Validate Inputs
    if (!toDoctorId || !clientFirstName || !clientLastName || !clientEmail || !clientPhone || !consultationDate || !clientMessage) {
        throw new BadRequestError("Tous les champs du formulaire sont obligatoires.");
    }

    const parsedConsultationDate = new Date(consultationDate);
    const now = new Date();
    // Check if the date is valid AND in the future
    if (isNaN(parsedConsultationDate.getTime()) || parsedConsultationDate <= now) {
        throw new BadRequestError("La date et l'heure de consultation doivent être valides et dans le futur.");
    }

    try {
        // 2. Find Doctor's Details and Calendar Refresh Token from DB
        const doctor = await prisma.doctors.findUnique({
            where: { user_id: BigInt(toDoctorId) },
            include: { user: true } // Ensure to include the related user data
        });

        if (!doctor || !doctor.user || !doctor.user.email) {
            throw new BadRequestError("Médecin introuvable ou n'a pas d'email de contact.");
        }

        const doctorEmail = doctor.user.email;
        const doctorFullName = `${doctor.user.first_name || ''} ${doctor.user.last_name || ''}`.trim();
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
                <li><strong>Date et heure souhaitées:</strong> ${parsedConsultationDate.toLocaleString('fr-FR', {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false
                })}</li>
            </ul>
            <p><strong>Message du patient:</strong></p>
            <blockquote style="border-left: 4px solid #d39424; margin: 0; padding: 0 15px; color: #555;">
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
            try {
                // Set the doctor's refresh token to the OAuth2 client
                oauth2Client.setCredentials({
                    refresh_token: doctorGoogleCalendarRefreshToken,
                });

                // Get a new access token using the refresh token
                const { credentials } = await oauth2Client.refreshAccessToken();
                oauth2Client.setCredentials(credentials); // Update the client with the new access token

                const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

                const eventStartTime = parsedConsultationDate;
                const eventEndTime = new Date(parsedConsultationDate.getTime() + 30 * 60 * 1000); // Default 30-minute consultation

                const eventTimeZone = 'Africa/Tunis'; // Set a consistent timezone for events

                const event = {
                    summary: `Consultation avec ${clientFirstName} ${clientLastName}`,
                    location: `${doctor.address || ''}, ${doctor.city || ''}, ${doctor.user.country || ''}`.trim() || 'Cabinet médical',
                    description: `Demande de consultation via Realsmile.\n\n` +
                                 `Patient: ${clientFirstName} ${clientLastName}\n` +
                                 `Email: ${clientEmail}\n` +
                                 `Téléphone: ${clientPhone}\n` +
                                 `Message du patient: "${clientMessage}"\n\n` +
                                 `Merci de confirmer ou reprogrammer avec le patient.`,
                    start: {
                        dateTime: eventStartTime.toISOString(), // ISO string is preferred for consistency
                        timeZone: eventTimeZone,
                    },
                    end: {
                        dateTime: eventEndTime.toISOString(),
                        timeZone: eventTimeZone,
                    },
                    attendees: [
                        { 'email': doctorEmail, organizer: true, self: true }, // Doctor is the organizer
                        { 'email': clientEmail, displayName: `${clientFirstName} ${clientLastName}`, responseStatus: 'needsAction' } // Patient is an attendee
                    ],
                    reminders: {
                        useDefault: false,
                        overrides: [
                            { method: 'email', minutes: 24 * 60 }, // 24 hours before
                            { method: 'popup', minutes: 60 },     // 1 hour before
                        ],
                    },
                    conferenceData: { // This generates a Google Meet link
                        createRequest: {
                            requestId: `realsmile-consultation-${Date.now()}`, // Unique ID for meeting creation
                            conferenceSolutionKey: {
                                type: 'hangoutsMeet'
                            }
                        }
                    },
                    sendNotifications: true, // Send email notifications for the event creation
                    colorId: '4', // Green color in Google Calendar for easy identification
                };

                const createdEvent = await calendar.events.insert({
                    calendarId: 'primary', // Use 'primary' for the doctor's primary calendar
                    resource: event,
                    sendUpdates: 'all', // Send updates to all attendees (patient, doctor)
                    conferenceDataVersion: 1, // Important for generating Meet link
                });

                console.log('Google Calendar event created for doctor:', createdEvent.data.htmlLink);
                calendarEventLink = createdEvent.data.htmlLink;

            } catch (calendarError) {
                console.error(`Failed to create Google Calendar event for doctor ${doctorEmail}:`, calendarError.message);
                if (calendarError.response && calendarError.response.data) {
                    console.error("Google API Error Details:", calendarError.response.data);
                }
                // Don't rethrow, just log and continue. The email was already sent.
                // Frontend will still get a success message, but calendarEventLink will be null.
            }
        } else {
            console.warn(`Doctor ${doctor.user.email} has not linked their Google Calendar. Event not created.`);
        }

        // 5. Respond to Frontend
        res.status(200).json({
            message: "Demande de consultation envoyée au médecin. Un événement a été ajouté à son calendrier Google si lié.",
            calendarEventLink: calendarEventLink // Send the event link back if successfully created
        });

    } catch (error) {
        console.error("Error in requestConsultation:", error);
        if (error instanceof BadRequestError || error instanceof InternalError) {
             // If it's one of our custom errors, send its message
            next(error); // Pass to error handling middleware
        } else {
            // For unexpected errors, send a generic internal server error
            res.status(500).json({
                message: "Échec de l'envoi de la demande de consultation. Une erreur est survenue lors de l'opération.",
                error: error.message // For debugging, remove in production
            });
        }
    }
});





/**
 * @desc   Récupère les événements de consultation depuis le Google Calendar du médecin connecté.
 * @route  GET /api/contact/consultations
 * @access Private (Doctor only)
 */
exports.getDoctorConsultations = asyncHandler(async (req, res, next) => {
    const doctorId = req.user.id; // L'ID vient du middleware `protect`

    // 1. Récupérer le refresh token du médecin depuis la BDD
    const doctorUser = await prisma.users.findUnique({
        where: { id: BigInt(doctorId) },
    });

    if (!doctorUser || !doctorUser.googleCalendarRefreshToken) {
        // Le médecin n'a pas lié son calendrier, on renvoie une liste vide.
        // It's good practice to inform the user why the list is empty.
        return res.status(200).json({
            message: "Google Calendar not linked. No events to display.",
            events: []
        });
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALENDAR_REDIRECT_URI
    );

    try {
        // 2. Utiliser le refresh token pour obtenir un nouvel access token
        oauth2Client.setCredentials({
            refresh_token: doctorUser.googleCalendarRefreshToken,
        });

        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);

        // FIX: The variable was `oauth2client` (lowercase c), it should be `oauth2Client` (uppercase C).
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // 3. Lister les événements
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: oneYearAgo.toISOString(),
            q: 'Consultation avec', // Filter to get only consultation events created by your app
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250, // Limit the number of results
        });

        const events = response.data.items;

        if (!events || events.length === 0) {
            return res.status(200).json({ events: [] });
        }

        // 4. Formater les événements pour le calendrier frontend (react-big-calendar)
        const formattedEvents = events.map(event => ({
            id: event.id,
            title: event.summary,
            start: new Date(event.start.dateTime || event.start.date),
            end: new Date(event.end.dateTime || event.end.date),
            allDay: !!event.start.date, // If only a date is provided, it's an all-day event
            resource: { // Store extra details in the resource property
                description: event.description,
                location: event.location,
                attendees: event.attendees,
                meetLink: event.hangoutLink, // Google Meet link
                calendarLink: event.htmlLink, // Link to the event in Google Calendar
            }
        }));

        res.status(200).json({ events: formattedEvents });

    } catch (error) {
        console.error("Erreur lors de la récupération des événements Google Calendar:", error);
        // If the token is invalid (e.g., revoked by the user), it's a good idea to notify the user.
        if (error.response && error.response.data && (error.response.data.error === 'invalid_grant' || error.response.data.error === 'unauthorized_client')) {
             // Optionally, clear the invalid refresh token from the database
            await prisma.users.update({
                where: { id: BigInt(doctorId) },
                data: { googleCalendarRefreshToken: null },
            });
            return res.status(401).json({ message: "Votre autorisation pour Google Calendar a expiré ou a été révoquée. Veuillez reconnecter votre calendrier depuis les paramètres." });
        }
        res.status(500).json({ message: "Impossible de récupérer les événements du calendrier." });
    }
});