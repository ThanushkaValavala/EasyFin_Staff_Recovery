const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, caseController.getAssignedCases);
router.post('/entry', protect, caseController.createCase);
router.get('/:id', protect, caseController.getCaseDetail);

module.exports = router;
