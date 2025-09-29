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

router.get('/all-tree-heights-adjusted', fileController.getAllAdjustedTreeHeights);

router.get('/statistics/all-tree-dbhs-cm', fileController.getAllTreeDbhsCm);

// Get SUM of Tree Volumes (m³) - All logged-in users (or add specific role checks if needed)
router.get('/statistics/sum-tree-volumes-m3', fileController.getSumTreeVolumesM3);

// Get ALL Tree Volumes (m³) Data for Histogram - All logged-in users (or add specific role checks if needed)
router.get('/statistics/all-tree-volumes-m3-data', fileController.getAllTreeVolumesM3Data);

router.get('/stats/sum-carbon-tonnes', fileController.getSumTreeCarbonTonnes);

// Delete: Admin/Assigned DM (checkProjectAssignment applied *after* checkRole)
router.delete('/:id', checkRole([ROLES.ADMIN, ROLES.DATA_MANAGER]), checkProjectAssignment, fileController.deleteFile);

// Potree conversion route removed - files are now directly ready for point cloud viewer

// Assign Project (PATCH): Admin/DM (DM check is *inside* the controller now for target project)
router.patch('/:id', checkRole([ROLES.ADMIN, ROLES.DATA_MANAGER]), fileController.assignProjectToFile);

// Reassign File Details (PATCH)
router.patch(
    '/:id/reassign', 
    fileController.reassignFileDetails // <-- Use the new controller
);


module.exports = router;