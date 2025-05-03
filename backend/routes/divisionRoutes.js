const express = require('express');
const divisionController = require('../controllers/divisionController'); // Adjust path
const { protect } = require('../middleware/authMiddleware');        // Adjust path
const { checkRole } = require('../middleware/permissionsMiddleware'); // Adjust path
const ROLES = require('../config/roles');                          // Adjust path

const router = express.Router();

// --- Apply JWT Authentication Middleware to ALL division routes ---
router.use(protect);

// --- Division CRUD ---

// GET /api/divisions - Get all divisions (accessible to all authenticated users)
router.get('/', divisionController.getDivisions);

// POST /api/divisions - Create a new division (Admin Only)
router.post('/', checkRole(ROLES.ADMIN), divisionController.createDivision);

router.delete('/:divisionId', checkRole(ROLES.ADMIN), divisionController.deleteDivision);

module.exports = router;