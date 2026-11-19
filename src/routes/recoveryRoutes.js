const express = require('express');
const router = express.Router();

const recoverySessionController = require('../controllers/recoverySessionController');
const evidenceController = require('../controllers/evidenceController');

const { protect } = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const flow = require('../controllers/recoveryFlowController');
const places = require('../controllers/placesController');

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

// Flow routes — updated to support optional voice + new middleware
router.post('/start-with-photo', protect, upload.safeStartWithVoice(), flow.startWithPhoto);
router.post('/sessions/:sessionId/finish', protect, upload.safeFinishWithVoice(), flow.finishSession);
router.post('/sessions/:sessionId/finish-walk', protect, upload.safeFieldsWithVoice([{ name: 'voice', maxCount: 1 }]), flow.finishSessionWalk);

router.get('/evidence/:evidenceId/image', protect, evidenceController.getEvidenceImage);
router.get('/history', protect, flow.getHistory);

router.post(
  '/sync',
  protect,
  upload.safeFieldsWithVoice([
    { name: 'startPhoto', maxCount: 1 },
    { name: 'endPhoto', maxCount: 1 },
    { name: 'voice', maxCount: 1 }
  ]),
  flow.syncOfflineSession
);

router.get('/stats', protect, flow.getAgentStats);

// New: signed URL endpoints
router.get('/sessions/:sessionId/voice-url', protect, flow.getVoiceUrl);
router.get('/evidence/:evidenceId/url', protect, flow.getEvidenceUrl);

// Places / geocoding (proxied via Photon, rate-limited)
router.get('/places/search', protect, places.searchPlaces);
router.get('/places/reverse', protect, places.reverseGeocode);

module.exports = router;
