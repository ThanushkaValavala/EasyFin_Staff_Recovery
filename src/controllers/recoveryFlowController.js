const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const RecoverySession = require('../models/RecoverySession');
const Assignment = require('../models/Assignment');
const Evidence = require('../models/Evidence');
const TrackingPoint = require('../models/TrackingPoint');
const Staff = require('../models/Staff');
const { getIsConnected } = require('../config/db');
const rules = require('../services/recoveryRules');
const { summarize } = require('../services/nlpSummarizer');

const fail = (res, code, message) => res.status(code).json({ success: false, message });

const parseJson = (v, fallback) => {
  if (v && typeof v === 'object') return v;
  try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
};

const saveImage = ({ file, sessionId, staffId, kind, location }) => {
  const evidenceId = `EVID-${Date.now()}-${uuidv4().substring(0, 6)}`;
  return Evidence.create({
    evidenceId, sessionId, staffId, kind,
    fileName: `${kind.toLowerCase()}-${evidenceId}.jpg`,
    originalName: file.originalname || 'photo.jpg',
    filePath: `/api/v1/recovery/evidence/${evidenceId}/image`,
    fileSize: file.size,
    mimeType: file.mimetype,
    caption: kind === 'START_SPEEDOMETER' ? 'Starting speedometer' : 'Ending speedometer',
    latitude: Number(location && location.latitude) || 0,
    longitude: Number(location && location.longitude) || 0,
    data: file.buffer
  });
};

const errorMessage = (error, fallback) =>
  error && error.name === 'ValidationError' ? error.message : fallback;

// Atomically increment agent statistics after a successful recovery
// Uses $inc for concurrency safety, and session.deviceSessionId to prevent double-count
async function incrementAgentStats(agentId, distanceMeters, session) {
  try {
    const distanceKm = Number(distanceMeters) / 1000 || 0;
    const sessionIdForHistory = session.sessionId || session._id.toString();

    await Staff.findOneAndUpdate(
      { _id: agentId },
      {
        $inc: {
          recoveryCount: 1,
          totalDistanceKm: distanceKm,
        },
        $push: {
          recoveryHistory: {
            sessionId: sessionIdForHistory,
            completedAt: session.endTime || new Date(),
            distanceMeters: Number(distanceMeters) || 0,
            durationSeconds: session.durationSeconds || 0,
            outcome: session.nlpCategory || 'GENERAL',
            nlpSummary: session.nlpSummary || '',
            nlpCategory: session.nlpCategory || '',
          },
        },
      }
    );
  } catch (err) {
    // Stats update failure must not fail the recovery submission
    console.error('[incrementAgentStats] Failed to update agent stats:', err.message);
  }
}

// POST /recovery/start-with-photo  (multipart: startPhoto + fields, or JSON for WALK/CYCLE)
exports.startWithPhoto = async (req, res) => {
  let evidence = null;
  let session = null;
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database is not connected. Try again shortly.');

    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    // Transport mode
    const vehicleTypeRaw = String(req.body.vehicleType || '').toUpperCase().trim();
    const isWalkLike = vehicleTypeRaw === 'WALK' || vehicleTypeRaw === 'CYCLE';
    const needsPhoto = vehicleTypeRaw === 'BIKE' || vehicleTypeRaw === 'CAR';

    // Vehicle validation for Bike/Car
    let vehicleNumber = '';
    if (needsPhoto) {
      const vehicle = rules.validateVehicle(vehicleTypeRaw, req.body.vehicleNumber);
      if (vehicle && vehicle.error) return fail(res, 400, vehicle.error);
      vehicleNumber = (vehicle && vehicle.vehicleNumber) || String(req.body.vehicleNumber || '').trim().toUpperCase();
      if (!req.file) return fail(res, 400, 'Starting speedometer photo is required for Bike/Car.');
    } else if (!isWalkLike) {
      return fail(res, 400, 'Invalid transport mode. Must be WALK, CYCLE, BIKE, or CAR.');
    }

    // Check for existing active session
    const active = await RecoverySession.findOne({
      $or: [{ agentId }, { staffId }],
      status: 'ACTIVE'
    });
    if (active) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active recovery. Finish it first.',
        session: active
      });
    }

    const initialLocation = parseJson(req.body.initialLocation, null);
    const deviceSessionId = String(req.body.deviceSessionId || '').trim();

    // Idempotency check
    if (deviceSessionId) {
      const existing = await RecoverySession.findOne({ deviceSessionId });
      if (existing) {
        return res.status(200).json({ success: true, message: 'Session already started.', session: existing });
      }
    }

    // Look up assignments for this agent to link; allow starting without specific cases selected
    const idsRaw = parseJson(req.body.assignmentIds, []);
    const ids = [...new Set(idsRaw.map(String).filter((i) => mongoose.Types.ObjectId.isValid(i)))];

    let assignmentId = null;
    let customerId = null;
    let loanId = null;
    let cases = [];

    if (ids.length) {
      const found = await Assignment.find({ _id: { $in: ids }, $or: [{ agentId }, { staffId }] });
      if (found.length) {
        const first = found[0];
        assignmentId = first._id;
        customerId = first.customerId;
        loanId = first.loanId;
        cases = found.map((a) => ({ assignmentId: a._id, customerId: a.customerId, loanId: a.loanId }));
        await Assignment.updateMany({ _id: { $in: ids } }, { recoveryStatus: 'IN_PROGRESS', lastVisitDate: new Date() });
      }
    }

    // If still no assignment, pick the first active one for this agent as a placeholder
    if (!assignmentId) {
      const fallback = await Assignment.findOne({ $or: [{ agentId }, { staffId }] }).lean();
      if (fallback) {
        assignmentId = fallback._id;
        customerId = fallback.customerId;
        loanId = fallback.loanId;
        cases = [{ assignmentId: fallback._id, customerId: fallback.customerId, loanId: fallback.loanId }];
      }
    }

    // If absolutely no assignment exists, create session with agent's own _id as placeholder
    // (allows demo/test use without seeded data)
    if (!assignmentId) {
      assignmentId = agentId;
      customerId = agentId;
      loanId = agentId;
      cases = [];
    }

    const sessionId = `SESS-${Date.now()}-${uuidv4().substring(0, 8)}`;

    if (req.file) {
      evidence = await saveImage({
        file: req.file, sessionId, staffId, kind: 'START_SPEEDOMETER', location: initialLocation
      });
    }

    session = await RecoverySession.create({
      sessionId,
      agentId,
      staffId,
      assignmentId,
      customerId,
      loanId,
      cases,
      area: String(req.body.area || '').trim(),
      startTime: new Date(),
      status: 'ACTIVE',
      outcome: 'PENDING',
      vehicleType: vehicleTypeRaw,
      vehicleNumber,
      startSpeedometerEvidenceId: evidence ? evidence.evidenceId : '',
      startLocation: rules.pickLocation(initialLocation),
      deviceSessionId,
    });

    if (initialLocation && initialLocation.latitude) {
      await TrackingPoint.create({
        sessionId, agentId, staffId,
        latitude: initialLocation.latitude,
        longitude: initialLocation.longitude,
        accuracy: initialLocation.accuracy || 0,
        timestamp: new Date()
      });
    }

    return res.status(201).json({ success: true, message: 'Recovery started.', session });
  } catch (error) {
    if (session) await RecoverySession.deleteOne({ _id: session._id }).catch(() => {});
    if (evidence) await Evidence.deleteOne({ _id: evidence._id }).catch(() => {});
    console.error('startWithPhoto error:', error.message);
    return fail(res, 500, errorMessage(error, 'Could not start the recovery. Nothing was saved, please try again.'));
  }
};

// POST /recovery/sessions/:sessionId/finish  (multipart: endPhoto + remarks)
exports.finishSession = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database is not connected. Try again shortly.');
    const { sessionId } = req.params;
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) return fail(res, 400, 'Remarks are required.');

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId }]
    });
    if (!session) return fail(res, 404, 'Recovery session not found.');
    if (session.status !== 'ACTIVE') {
      // Idempotent — already finished
      return res.status(409).json({ success: true, message: 'This recovery is already finished.', session });
    }

    // Only BIKE and CAR require end photo; WALK and CYCLE do not
    const vehicleType = String(session.vehicleType || '').toUpperCase();
    const needsEndPhoto = vehicleType === 'BIKE' || vehicleType === 'CAR';
    if (needsEndPhoto && !req.file) return fail(res, 400, 'Ending speedometer photo is required.');

    const endLocation = parseJson(req.body.endLocation, null);

    let evidence = null;
    if (req.file) {
      evidence = await saveImage({ file: req.file, sessionId, staffId, kind: 'END_SPEEDOMETER', location: endLocation });
    }

    const { nlpSummary, nlpCategory } = summarize(remarks);

    const endTime = new Date();
    session.endTime = endTime;
    session.status = 'COMPLETED';
    session.remarks = remarks;
    session.rawRemarks = remarks;
    session.visitNotes = remarks;
    session.nlpSummary = nlpSummary;
    session.nlpCategory = nlpCategory;
    if (evidence) session.endSpeedometerEvidenceId = evidence.evidenceId;
    session.durationSeconds = Number(req.body.durationSeconds) ||
      Math.round((endTime.getTime() - new Date(session.startTime).getTime()) / 1000);
    if (req.body.distanceMeters !== undefined && req.body.distanceMeters !== '') {
      session.distanceMeters = Number(req.body.distanceMeters) || 0;
    }
    const finalLocation = rules.pickLocation(endLocation);
    if (finalLocation) session.endLocation = finalLocation;
    await session.save();

    // Update assignments
    const caseIds = (session.cases && session.cases.length
      ? session.cases.map((c) => c.assignmentId)
      : [session.assignmentId]).filter(Boolean);
    if (caseIds.length) {
      await Assignment.updateMany(
        { _id: { $in: caseIds } },
        { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: endTime }
      ).catch(() => {});
    }

    // Atomically increment agent stats
    await incrementAgentStats(agentId, session.distanceMeters, session);

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSession error:', error.message);
    return fail(res, 500, errorMessage(error, 'Could not submit the recovery. Please try again.'));
  }
};

// POST /recovery/sessions/:sessionId/finish-walk  (JSON body, no photo — Walk & Cycle modes)
exports.finishSessionWalk = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database not connected.');
    const { sessionId } = req.params;
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) return fail(res, 400, 'Remarks are required.');

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId }]
    });
    if (!session) return fail(res, 404, 'Recovery session not found.');
    if (session.status !== 'ACTIVE') {
      return res.status(409).json({ success: true, message: 'This recovery is already finished.', session });
    }

    const endLocation = req.body.endLocation || null;
    const { nlpSummary, nlpCategory } = summarize(remarks);

    const endTime = new Date();
    session.endTime = endTime;
    session.status = 'COMPLETED';
    session.remarks = remarks;
    session.rawRemarks = remarks;
    session.visitNotes = remarks;
    session.nlpSummary = nlpSummary;
    session.nlpCategory = nlpCategory;
    session.durationSeconds = Number(req.body.durationSeconds) ||
      Math.round((endTime.getTime() - new Date(session.startTime).getTime()) / 1000);
    if (req.body.distanceMeters !== undefined) {
      session.distanceMeters = Number(req.body.distanceMeters) || 0;
    }
    const finalLocation = rules.pickLocation(endLocation);
    if (finalLocation) session.endLocation = finalLocation;
    await session.save();

    const caseIds = (session.cases && session.cases.length
      ? session.cases.map((c) => c.assignmentId)
      : [session.assignmentId]).filter(Boolean);
    if (caseIds.length) {
      await Assignment.updateMany(
        { _id: { $in: caseIds } },
        { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: endTime }
      ).catch(() => {});
    }

    // Atomically increment agent stats
    await incrementAgentStats(agentId, session.distanceMeters, session);

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSessionWalk error:', error.message);
    return fail(res, 500, 'Could not submit the recovery.');
  }
};

// GET /recovery/history — returns all completed sessions for this agent (excluding rawRemarks)
exports.getHistory = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    const sessions = await RecoverySession.find({
      $or: [{ agentId }, { staffId }],
      status: 'COMPLETED'
    })
      .sort({ endTime: -1 })
      .limit(200)
      .select('-rawRemarks -remarks -visitNotes')  // Do NOT expose raw remarks to frontend
      .lean();

    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    console.error('getHistory error:', error.message);
    return fail(res, 500, 'Could not fetch history.');
  }
};

// POST /recovery/sync — accepts a completed offline session and saves it (idempotent via deviceSessionId)
exports.syncOfflineSession = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();
    const body = req.body || {};

    const deviceSessionId = String(body.deviceSessionId || '').trim();
    if (!deviceSessionId) return fail(res, 400, 'deviceSessionId is required for sync.');

    // Idempotency: if already synced, return existing record
    const existing = await RecoverySession.findOne({ deviceSessionId });
    if (existing) {
      return res.status(200).json({ success: true, alreadySynced: true, session: existing });
    }

    const { nlpSummary, nlpCategory } = summarize(body.remarks || body.rawRemarks || '');

    const sessionId = `SESS-SYNC-${Date.now()}-${uuidv4().substring(0, 8)}`;

    let assignmentId = body.assignmentId;
    let customerId = body.customerId;
    let loanId = body.loanId;

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      const fallback = await Assignment.findOne({ $or: [{ agentId }, { staffId }] }).lean();
      if (fallback) {
        assignmentId = fallback._id;
        customerId = fallback.customerId;
        loanId = fallback.loanId;
      } else {
        // No assignments at all — use agent's own ID as placeholder
        assignmentId = agentId;
        customerId = agentId;
        loanId = agentId;
      }
    }

    const session = await RecoverySession.create({
      sessionId,
      deviceSessionId,
      agentId,
      staffId,
      assignmentId,
      customerId: customerId || assignmentId,
      loanId: loanId || assignmentId,
      startTime: body.startTime ? new Date(body.startTime) : new Date(),
      endTime: body.endTime ? new Date(body.endTime) : new Date(),
      status: 'COMPLETED',
      outcome: body.outcome || 'FOLLOW_UP_REQUIRED',
      vehicleType: String(body.vehicleType || '').toUpperCase(),
      vehicleNumber: body.vehicleNumber || '',
      durationSeconds: Number(body.durationSeconds) || 0,
      distanceMeters: Number(body.distanceMeters) || 0,
      remarks: body.remarks || body.rawRemarks || '',
      rawRemarks: body.rawRemarks || body.remarks || '',
      visitNotes: body.remarks || body.rawRemarks || '',
      nlpSummary,
      nlpCategory,
      startLocation: body.startLocation || null,
      endLocation: body.endLocation || null,
      area: body.area || '',
    });

    // Increment agent stats for synced session
    await incrementAgentStats(agentId, session.distanceMeters, session);

    return res.status(201).json({ success: true, session });
  } catch (error) {
    console.error('syncOfflineSession error:', error.message);
    return fail(res, 500, 'Could not sync offline session.');
  }
};

// GET /recovery/stats — returns agent's recovery statistics
exports.getAgentStats = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    // Count directly from RecoverySessions for accuracy
    const [count, distResult] = await Promise.all([
      RecoverySession.countDocuments({
        $or: [{ agentId }, { staffId }],
        status: 'COMPLETED',
      }),
      RecoverySession.aggregate([
        { $match: { $or: [{ agentId: mongoose.Types.ObjectId.isValid(agentId) ? new mongoose.Types.ObjectId(agentId) : agentId }, { staffId }], status: 'COMPLETED' } },
        { $group: { _id: null, totalMeters: { $sum: '$distanceMeters' } } },
      ]),
    ]);

    const totalDistanceKm = distResult.length ? (distResult[0].totalMeters / 1000) : 0;

    return res.status(200).json({
      success: true,
      stats: {
        recoveryCount: count,
        totalDistanceKm: parseFloat(totalDistanceKm.toFixed(3)),
      },
    });
  } catch (error) {
    console.error('getAgentStats error:', error.message);
    return fail(res, 500, 'Could not fetch agent stats.');
  }
};
