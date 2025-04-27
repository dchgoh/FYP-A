const express = require('express');
const userController = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');
const { checkRole } = require('../middleware/permissionsMiddleware');
const ROLES = require('../config/roles');

const router = express.Router();

// Apply JWT protection to all user routes
router.use(protect);

router.get('/', userController.getUsers); // Example: Controller handles logic
router.get('/count', userController.getUserCount); // Example

// Admin only routes
router.post('/', checkRole(ROLES.ADMIN), userController.addUser);
router.put('/:id', checkRole(ROLES.ADMIN), userController.updateUser);
router.delete('/:id', checkRole(ROLES.ADMIN), userController.deleteUser);
router.put('/:id/unlock', checkRole(ROLES.ADMIN), userController.unlockUser);

module.exports = router;