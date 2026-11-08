const express = require('express');
const router = express.Router();

const recoverySessionController = require('../controllers/recoverySessionController');
const evidenceController = require('../controllers/evidenceController');

const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const flow = require('../controllers/recoveryFlowController');

// Recovery session routes
router.post('/start', protect, recoverySessionController.startSession);

router.get('/active', protect, recoverySessionController.getActiveSession);

router.post(
  '/sessions/:sessionId/points',
  protect,
  recoverySessionController.addTrackingPoints
);

router.post(
  '/sessions/:sessionId/stops',
  protect,
  recoverySessionController.recordStop
);

router.patch(
  '/sessions/:sessionId/outcome',
  protect,
  recoverySessionController.updateSessionOutcome
);

router.post(
  '/sessions/:sessionId/end',
  protect,
  recoverySessionController.endSession
);

// Evidence routes
router.post(
  '/sessions/:sessionId/evidence',
  protect,
  upload.safeSingle('photo'),
  evidenceController.uploadEvidence
);

router.get(
  '/sessions/:sessionId/evidence',
  protect,
  evidenceController.getSessionEvidence
);
// Get complete journey details
router.get(
  '/sessions/:sessionId/journey',
  protect,
  recoverySessionController.getJourneyDetails
);
router.post('/start-with-photo', protect, upload.safeSingle('startPhoto'), flow.startWithPhoto);
router.post('/sessions/:sessionId/finish', protect, upload.safeSingle('endPhoto'), flow.finishSession);
router.post('/sessions/:sessionId/finish-walk', protect, flow.finishSessionWalk);
router.get('/evidence/:evidenceId/image', protect, evidenceController.getEvidenceImage);
router.get('/history', protect, flow.getHistory);
router.post('/sync', protect, flow.syncOfflineSession);
router.get('/stats', protect, flow.getAgentStats);

module.exports = router;