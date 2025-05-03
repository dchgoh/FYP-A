const express = require('express');
const projectController = require('../controllers/projectController'); // Adjust path
const { protect } = require('../middleware/authMiddleware');        // Adjust path
const { checkRole } = require('../middleware/permissionsMiddleware'); // Adjust path
const ROLES = require('../config/roles');                          // Adjust path

const router = express.Router();

// --- Apply JWT Authentication Middleware to ALL project routes ---
router.use(protect);

// --- Project CRUD ---

// GET /api/projects - Get all projects (accessible to all authenticated users)
router.get('/', projectController.getProjects);

// POST /api/projects - Create a new project (Admin Only)
router.post('/', checkRole(ROLES.ADMIN), projectController.createProject);

// DELETE /api/projects/:projectId - Delete a project (Admin Only)
// Note: The route parameter name 'projectId' matches the controller's expectation
router.delete('/:projectId', checkRole(ROLES.ADMIN), projectController.deleteProject);


// --- Project Data Manager Assignments ---

// POST /api/projects/:projectId/datamanagers - Assign a DM to a project (Admin Only)
router.post('/:projectId/datamanagers', checkRole(ROLES.ADMIN), projectController.assignDataManager);

// GET /api/projects/:projectId/datamanagers - Get DMs assigned to a specific project (Admin Only)
router.get('/:projectId/datamanagers', checkRole(ROLES.ADMIN), projectController.getProjectDataManagers);

// DELETE /api/projects/:projectId/datamanagers/:userId - Unassign a DM from a project (Admin Only)
router.delete('/:projectId/datamanagers/:userId', checkRole(ROLES.ADMIN), projectController.unassignDataManager);


// --- User-Specific Project Route ---

// GET /api/projects/assigned-to-me - Get projects assigned to the current logged-in user (mainly for DMs)
// (Placed here for project context, uses req.user from 'protect')
router.get('/assigned-to-me', projectController.getMyAssignedProjects);
// Note: The controller logic handles filtering based on the user's role (req.user.role)


module.exports = router;