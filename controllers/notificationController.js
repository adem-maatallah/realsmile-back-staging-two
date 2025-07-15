const {
    collection,
    getDocs
} = require("firebase/firestore");
const logger = require("../utils/logger");
const { db } = require("../utils/firebaseConfig");

const getAllNotifications = async (userRole, userId) => {
    const customersRef = collection(db, 'customers');
    const customersSnapshot = await getDocs(customersRef);

    const allNotifications = [];

    for (const customerDoc of customersSnapshot.docs) {
        const customerData = customerDoc.data();
        // Check if the user is admin or if the user is fetching their own notifications
        if (userRole === 'admin' || customerDoc.id == userId) {
            const customerNotificationsRef = collection(
                customerDoc.ref,
                'customernotifications'
            );

            const notificationsSnapshot = await getDocs(customerNotificationsRef);

            notificationsSnapshot.forEach((doc) => {
                const notificationData = doc.data();
                notificationData.list.forEach((notification) => {
                    allNotifications.push({
                        unseen: notification.xf4,
                        title: notification.xa2,
                        description: notification.xa3,
                        imageURL: notification.xa5,
                        created_at: notification.xd1,
                        userId: customerDoc.id,
                        userName: customerData.nck,
                        userImage: customerData.pu,
                        userPhone: customerData.phn
                    });
                });
            });
        }
    }
    allNotifications.sort((a, b) => b.created_at - a.created_at)

    return allNotifications;
};

exports.fetchAll = async (req, res) => {
    const user = req.user;
    const {
        role,
        id
    } = req.user; // Assume you have user info in req.user
    try {
        const notifications = await getAllNotifications(role, id);
        res.status(200).json(notifications);
    } catch (error) {
        logger.error('Error fetching notifications: ', error);
        res.status(500).json({
            message: 'Failed to fetch notifications.',
        });
    }
}