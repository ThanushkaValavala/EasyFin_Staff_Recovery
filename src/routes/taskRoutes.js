const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, taskController.getAssignedTasks);
router.get('/assigned', protect, taskController.getAssignedTasks);
router.get('/completed', protect, taskController.getCompletedTasks);
router.get('/locations', protect, taskController.getLocations);
router.get('/active', protect, taskController.getActiveTask);
router.get('/completed/:taskId', protect, taskController.getCompletedTaskDetail);

router.post('/:customerId/start', protect, taskController.startTaskRecovery);
router.post('/:customerId/complete', protect, taskController.completeTask);
router.post('/:customerId/cancel', protect, taskController.cancelTaskRecovery);

module.exports = router;
