// firebase-config.js
// Admin SDK (server-side)
const admin = require('firebase-admin');

// Client SDK (typically for front-end, but can be used on server)
const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

// Initialize Admin SDK apps
const patientApp = admin.initializeApp({
  credential: admin.credential.cert(process.env.FIREBASE_PATIENT_APP_SERVICE_ACCOUNT_KEY),
}, 'patient-app');

const doctorApp = admin.initializeApp({
  credential: admin.credential.cert(process.env.GOOGLE_STORAGE_KEY_FILENAME),
}, 'doctor-app');

// Initialize client SDK app (if needed)
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const clientApp = initializeApp(firebaseConfig, 'client-app');
const clientDb = getFirestore(clientApp);

// Export everything
module.exports = {
  // Admin SDK exports
  admin,
  patientApp,
  doctorApp,
  patientAuth: patientApp.auth(),
  doctorAuth: doctorApp.auth(),
  patientFirestore: patientApp.firestore(),
  doctorFirestore: doctorApp.firestore(),
  patientMessaging: patientApp.messaging(),
  
  // Client SDK exports
  clientApp,
  db: clientDb  // Export as 'db' to maintain compatibility with your existing code
};