const express = require("express");
const router = express.Router();
const authController = require("../../controllers/authController");
const notificationController = require("../../controllers/notificationController");

const {
  doc,
  updateDoc,
  arrayUnion,
  getDoc,
  getDocs,
  collection,
} = require("firebase/firestore");
const admin = require("firebase-admin");
const logger = require("../../utils/logger");
const { doctorFirestore, db } = require("../../utils/firebaseConfig");

// Function to send a notification to a customer
const sendNotification = async (customerId, notificationData) => {
  const customerNotificationsDocRef = doc(
    db,
    "customers",
    customerId,
    "customernotifications",
    "customernotifications"
  );

  const docSnap = await getDoc(customerNotificationsDocRef);
  if (docSnap.exists()) {
    // Append the new notification to the list field
    await updateDoc(customerNotificationsDocRef, {
      list: arrayUnion(notificationData),
      xa2: notificationData.xa2 || "",
      xa3: notificationData.xa3 || "",
      xa4: "PUSH",
      xa5: notificationData.xa5 || "",
      xd1: Date.now(),
    });
    return true;
  } else {
    logger.error(`Document for customer ID ${customerId} not found.`);
    return false;
  }
};

router.post("/send-notifications", async (req, res) => {
  const {
    customerIds,
    title,
    description,
    imageURL
  } = req.body;

  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return res.status(400).send("customerIds must be a non-empty array.");
  }

  try {
    const notificationPromises = customerIds.map(async (customerId) => {
      const newNotification = {
        xa1: customerId,
        xa2: title || "Nouveau Ticket créé",
        xa3: description || `Vous a créé un nouveau Ticket de support. ID du ticket : 6845865`,
        xa5: imageURL || "",
        xa9: "",
        xd1: doctorFirestore.Timestamp.now().toMillis(), // Set xd1 to current timestamp in milliseconds
        xf4: false, // Assuming this field needs to be set to false initially
      };

      return await sendNotification(customerId, newNotification);
    });

    const results = await Promise.all(notificationPromises);
    const successCount = results.filter((result) => result).length;

    res
      .status(200)
      .json({
        message: `${successCount} notifications added successfully out of ${customerIds.length}.`
      });
  } catch (error) {
    logger.error("Error sending notifications: ", error);
    res.status(500).json({
      message: "Failed to send notifications."
    });
  }
});

router.get(
  "/",
  authController.protect,
  notificationController.fetchAll,
);

module.exports = router;