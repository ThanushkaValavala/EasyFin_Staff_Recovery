const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { protect } = require('../middleware/authMiddleware');

router.get('/dashboard', protect, analyticsController.getDashboardStats);

// ADD THIS LINE:
router.get('/collections', protect, analyticsController.getCollectionHistory);

module.exports = router;
