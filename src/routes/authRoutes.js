const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', authController.login);
router.post('/register', authController.register);

router.get('/profile', protect, authController.getProfile);
router.post('/staff', protect, authController.createStaff);

module.exports = router;