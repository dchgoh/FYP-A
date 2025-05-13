const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

router.post('/login', authController.login);
router.post('/verify-mfa', authController.verifyMfa);

module.exports = router;