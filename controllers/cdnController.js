const multer = require('multer'); // Ensure multer is installed via npm
const { uploadStatcFiles } = require('../utils/googleCDN');
const upload = multer({storage: multer.memoryStorage()});
const cpUpload = upload.fields([{ name: 'staticFiles', maxCount: 10 }]);

exports.uploadStaticFiles = async (req, res) => {
    cpUpload(req, res, async (error) => {
        if (error) {
            return res.status(500).json({error: error.message});
        }
        try {
            if (req.files.staticFiles && req.files.staticFiles.length > 0) {
                // Assuming the intention is to upload files under 'stls' field
                const uploadResults = await uploadStatcFiles(req.files.staticFiles, process.env.GOOGLE_STORAGE_BUCKET_CASE_STATICS);
                // Assuming there is a follow-up action with uploadResults or other related logic
                res.status(200).json({
                    message: "Files uploaded successfully",
                    data: uploadResults
                });
            } else {
                // Handle the case where no relevant files were uploaded
                res.status(400).json({
                    message: "No STL files were uploaded"
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
