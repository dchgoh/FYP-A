const express = require('express');
const fileController = require('../controllers/fileController');
const { protect } = require('../middleware/authMiddleware');
const { checkRole, checkProjectAssignment } = require('../middleware/permissionsMiddleware');
const upload = require('../middleware/uploadMiddleware'); // Import multer middleware
const ROLES = require('../config/roles');

const router = express.Router();

// Apply JWT protection globally first
router.use(protect);

// Upload: Admin/DM, use multer middleware 'upload.single' *before* controller
router.post('/upload', checkRole([ROLES.ADMIN, ROLES.DATA_MANAGER]), upload.single('file'), fileController.uploadFile);

// Get List: All logged-in users
router.get('/', fileController.getFiles);

// Download: All logged-in users (Frontend gates further)
router.get('/download/:id', fileController.downloadFile);

// Delete: Admin/Assigned DM (checkProjectAssignment applied *after* checkRole)
router.delete('/:id', checkRole([ROLES.ADMIN, ROLES.DATA_MANAGER]), checkProjectAssignment, fileController.deleteFile);

// Convert: Admin/Regular/DM (custom logic in route definition, then controller)
router.get('/potreeconverter/:id', (req, res, next) => {
    if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.REGULAR || req.user.role === ROLES.DATA_MANAGER) {
         return next();
    }
    return res.status(403).json({ success: false, message: "Forbidden: Role not authorized." });
}, fileController.convertFile); // Pass to controller if authorized

// Assign Project (PATCH): Admin/DM (DM check is *inside* the controller now for target project)
router.patch('/:id', checkRole([ROLES.ADMIN, ROLES.DATA_MANAGER]), fileController.assignProjectToFile);

module.exports = router;