// routes/fileRoutes.js
const express = require('express');
const fileController = require('../controllers/fileController');
const { protect } = require('../middleware/authMiddleware');
const { checkRole, checkProjectAssignment } = require('../middleware/permissionsMiddleware');
const upload = require('../middleware/uploadMiddleware'); // Import multer middleware
const ROLES = require('../config/roles');

const router = express.Router();

// Apply JWT protection globally first
router.use(protect);

// --- Existing Routes ---
// Upload: Admin/DM, use multer middleware 'upload.single' *before* controller
router.post('/upload', checkRole([ROLES.ADMIN, ROLES.DATA_MANAGER]), upload.single('file'), fileController.uploadFile);

// Get List: All logged-in users
router.get('/', fileController.getFiles);

// *** NEW: Get Recent Files (for dashboard timeline) ***
router.get('/recent', fileController.getRecentFiles);

// *** NEW: Get File Count ***
router.get('/count', fileController.getFileCount);

// --- NEW: Get Total Tree Count ---
router.get('/count/trees', fileController.getTreeCount); 

// Download: All logged-in users (Frontend gates further)
router.get('/download/:id', fileController.downloadFile);

router.get('/plots', fileController.getDistinctPlotNames);

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

// Reassign File Details (PATCH)
router.patch(
    '/:id/reassign', // Using :id for the fileId
    // protect, // Already applied globally
    // Permission check will be mostly inside the controller for this complex case
    // checkRole([ROLES.ADMIN, ROLES.DATA_MANAGER]), // Basic role check
    fileController.reassignFileDetails // <-- Use the new controller
);


module.exports = router;