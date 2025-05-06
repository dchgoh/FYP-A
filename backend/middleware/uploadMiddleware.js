const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Store relative to project root
        const uploadPath = path.resolve(__dirname, '../uploads');
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + safeOriginalName);
    }
});

const upload = multer({ storage: storage });

module.exports = upload; 