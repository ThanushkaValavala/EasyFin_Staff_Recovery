const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', authController.login);
router.post('/register', authController.register);

// Both /otp/generate and specification /send-otp
router.post('/otp/generate', authController.generateOtp);
router.post('/send-otp', authController.generateOtp);

// Both /otp/verify and specification /verify-otp
router.post('/otp/verify', authController.verifyOtp);
router.post('/verify-otp', authController.verifyOtp);

router.get('/profile', protect, authController.getProfile);
router.post('/staff', protect, authController.createStaff);

module.exports = router;
