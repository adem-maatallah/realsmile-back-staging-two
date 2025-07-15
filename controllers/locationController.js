const { PrismaClient } = require("@prisma/client");
const { withAccelerate } = require("@prisma/extension-accelerate");
const asyncHandler = require("express-async-handler");
const prisma = new PrismaClient().$extends(withAccelerate());

exports.createLocation = async (req, res) => {
        const { latitude, longitude } = req.body;
        const userId = req.user.id; // Get user ID from the authenticated session

        // Basic validation
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            return res.status(400).json({ message: 'Latitude and longitude must be valid numbers.' });
        }

        try {
            // Use Prisma to update the user's latitude and longitude
            const updatedUser = await prisma.users.update({
                where: { id: BigInt(userId) }, // Assuming 'id' is the primary key and matches userId
                data: {
                    latitude: latitude,
                    longitude: longitude,
                    // You might also want to add an 'updatedAt' timestamp here
                    // updatedAt: new Date(),
                },
            });

            res.status(201).json({
                message: 'Location saved successfully!',
                userId: Number(updatedUser.id),
                latitude: updatedUser.latitude,
                longitude: updatedUser.longitude,
            });
        } catch (error) {
            console.error('Error saving location to database:', error);
            // Check if the error is due to user not found
            if (error.code === 'P2025') { // Prisma error code for record not found
                return res.status(404).json({ message: 'User not found.', error: error.message });
            }
            res.status(500).json({ message: 'Failed to save location.', error: error.message });
        }
    }

// Renamed from /api/locations to reflect that it gets the single current location.
exports.getLocation = async (req, res) => {
    const userId = req.user.id; // Get user ID from the authenticated session

    try {
        // Use Prisma to fetch the current user's latitude and longitude
        const userLocation = await prisma.users.findUnique({
            where: { id: BigInt(userId) }, // Assuming 'id' is the primary key and matches userId
            select: {
                id: true,
                latitude: true,
                longitude: true,
                // Include any other relevant user fields if needed
            },
        });

        if (!userLocation) {
            return res.status(404).json({ message: 'User not found or no location data available.' });
        }

        res.status(200).json({
            id: Number(userLocation.id),
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            timestamp: new Date().toISOString(), // Provide a current timestamp for consistency, as 'users' table might not have one for location
        });
    } catch (error) {
        console.error('Error retrieving current location from database:', error);
        res.status(500).json({ message: 'Failed to retrieve current location.', error: error.message });
    }
};