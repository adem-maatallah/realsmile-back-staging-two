const multer = require('multer'); // Ensure multer is installed via npm
const {
    uploadSingleChatFile
} = require('../utils/googleCDN');
const upload = multer({
    storage: multer.memoryStorage()
});
const cpUpload = upload.fields([{
    name: 'file',
    maxCount: 1
}]);
const asyncHandler = require("express-async-handler");
const {
    PrismaClient
} = require('@prisma/client');
const {
    withAccelerate
} = require('@prisma/extension-accelerate')

const prisma = new PrismaClient().$extends(withAccelerate())
const {
    createMobileUserUtils
} = require("../firebase/mobileUser");
const {
    parsePhoneNumberFromString
} = require('libphonenumber-js');
const admin = require("firebase-admin");
const {
    createSendToken,
    createSendTokenMobile
} = require('./authController');
const {
    extractSingleImage
} = require('../utils/caseUtils');

const doctor_image_url = "https://realsmilealigner.com/upload/";

exports.uploadChatFiles = async (req, res) => {
    cpUpload(req, res, async (error) => {
        if (error) {
            return res.status(500).json({
                error: error.message
            });
        }
        try {
            if (req.files.file && req.files.file.length > 0) {
                // Assuming the intention is to upload files under 'stls' field
                const uploadResults = await uploadSingleChatFile(req.files.file[0], process.env.GOOGLE_STORAGE_BUCKET_CHAT_STATICS);
                // Assuming there is a follow-up action with uploadResults or other related logic
                res.status(200).json({
                    message: "Files uploaded successfully",
                    data: uploadResults
                });
            } else {
                // Handle the case where no relevant files were uploaded
                res.status(400).json({
                    message: "No Chat files were uploaded"
                });
            }
        } catch (error) {
            console.error("Error handling file upload", error);
            res.status(500).json({
                message: "Failed to upload files",
                error: error.message
            });
        }
    })
};

exports.createMobileUser = asyncHandler(async (req, res) => {
    const {
        id,
        role
    } = req.body; // Extract data
    const roleLowered = role.toLowerCase(); // Convert role to lowercase

    // Validate the necessary data
    if (!id) {
        return res.status(400).json({
            message: 'Missing required field: id'
        });
    }
    if (!roleLowered) {
        return res.status(400).json({
            message: 'Missing required field: type'
        });
    }
    if (roleLowered !== 'agent' && roleLowered !== 'customer') {
        return res.status(400).json({
            message: 'Invalid user type'
        });
    }

    try {
        // Fetch user data from the database
        const user = await prisma.users.findUnique({
            where: {
                id: parseInt(id)
            }
        });

        if (!user) {
            console.error('User not found');
            return res.status(404).json({
                message: 'User not found'
            });
        }

        console.log('Fetched user:', user);

        // Parse the phone number
        const parsedPhone = parsePhoneNumberFromString(user.phone);
        if (!parsedPhone) {
            return res.status(400).json({
                message: 'Invalid phone number'
            });
        }

        const countryCode = `+${parsedPhone.countryCallingCode}`;
        const rawPhone = parsedPhone.nationalNumber;

        const photoUrl = user.profile_pic || "";

        // Attempt to create a mobile user
        const result = await createMobileUserUtils({
            id,
            nickname: `${user.first_name} ${user.last_name}`,
            phone: rawPhone,
            phoneWithCountryCode: user.phone,
            countryCode,
            photoUrl,
            roleLowered
        });

        if (result.success) {
            // Update has_mobile_account in the users table
            const user = await prisma.users.update({
                where: {
                    id: parseInt(id)
                },
                data: {
                    has_mobile_account: true
                },
                include: {
                    role: true
                }
            });
            user.id = Number(user.id);
            user.role_id = Number(user.role_id);
            user.profile_pic = extractSingleImage(user?.profile_pic, doctor_image_url) || "https://storage.googleapis.com/realsmilefiles/staticFolder/doctorCompress.png"

            createSendTokenMobile(user, req, res);
        } else {
            res.status(500).json({
                message: 'Failed to create user',
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error creating mobile user:', error);
        res.status(500).json({
            message: 'Failed to create user',
            error: error.message
        });
    }
});