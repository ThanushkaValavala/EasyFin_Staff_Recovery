const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const RecoverySession = require('../models/RecoverySession');
const Assignment = require('../models/Assignment');
const Evidence = require('../models/Evidence');
const TrackingPoint = require('../models/TrackingPoint');
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

// POST /recovery/start-with-photo  (multipart: startPhoto + fields)
exports.startWithPhoto = async (req, res) => {
  let evidence = null;
  let session = null;
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database is not connected. Try again shortly.');

    const staffId = req.staff._id.toString();
    const ids = [...new Set(parseJson(req.body.assignmentIds, []).map(String))];
    if (!ids.length) return fail(res, 400, 'Select at least one case.');
    if (!ids.every((i) => mongoose.Types.ObjectId.isValid(i))) return fail(res, 400, 'Invalid case selection.');

    const vehicle = rules.validateVehicle(req.body.vehicleType, req.body.vehicleNumber);

    // Walk mode: vehicleType is WALK — no photo or vehicle number required
    const isWalk = String(req.body.vehicleType || '').toUpperCase() === 'WALK';
    if (!isWalk) {
      if (vehicle && vehicle.error) return fail(res, 400, vehicle.error);
      if (!req.file) return fail(res, 400, 'Starting speedometer photo is required.');
    }

    const active = await RecoverySession.findOne({ staffId, status: 'ACTIVE' });
    if (active) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active recovery. Finish it first.',
        session: active
      });
    }

    const found = await Assignment.find({ _id: { $in: ids }, staffId });
    if (found.length !== ids.length) return fail(res, 404, 'One or more selected cases are not assigned to you.');
    const byId = new Map(found.map((a) => [a._id.toString(), a]));
    const ordered = ids.map((i) => byId.get(i));

    const initialLocation = parseJson(req.body.initialLocation, null);
    const deviceSessionId = String(req.body.deviceSessionId || '').trim();

    // Idempotency check: if the same deviceSessionId was already saved, return it
    if (deviceSessionId) {
      const existing = await RecoverySession.findOne({ deviceSessionId });
      if (existing) {
        return res.status(200).json({ success: true, message: 'Session already started.', session: existing });
      }
    }

    const sessionId = `SESS-${Date.now()}-${uuidv4().substring(0, 8)}`;

    // Walk mode: no photo required
    if (req.file) {
      evidence = await saveImage({ file: req.file, sessionId, staffId, kind: 'START_SPEEDOMETER', location: initialLocation });
    }

    const first = ordered[0];
    session = await RecoverySession.create({
      sessionId,
      staffId,
      assignmentId: first._id,
      customerId: first.customerId,
      loanId: first.loanId,
      cases: ordered.map((a) => ({ assignmentId: a._id, customerId: a.customerId, loanId: a.loanId })),
      area: String(req.body.area || '').trim(),
      startTime: new Date(),
      status: 'ACTIVE',
      outcome: 'PENDING',
      vehicleType: vehicle ? vehicle.vehicleType : '',
      vehicleNumber: vehicle ? vehicle.vehicleNumber : '',
      startSpeedometerEvidenceId: evidence ? evidence.evidenceId : '',
      startLocation: rules.pickLocation(initialLocation),
      deviceSessionId,
    });

    await Assignment.updateMany({ _id: { $in: ids } }, { recoveryStatus: 'IN_PROGRESS', lastVisitDate: new Date() });

    if (initialLocation && initialLocation.latitude) {
      await TrackingPoint.create({
        sessionId, staffId,
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

// POST /recovery/sessions/:sessionId/finish  (multipart: endPhoto + remarks ...)
exports.finishSession = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database is not connected. Try again shortly.');
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();

    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) return fail(res, 400, 'Remarks are required.');

    const session = await RecoverySession.findOne({ sessionId, staffId });
    if (!session) return fail(res, 404, 'Recovery session not found.');
    if (session.status !== 'ACTIVE') return fail(res, 409, 'This recovery is already finished.');

    // Walk mode: end photo is optional
    const isWalk = String(session.vehicleType || '').toUpperCase() === 'WALK';
    if (!isWalk && !req.file) return fail(res, 400, 'Ending speedometer photo is required.');

    const endLocation = parseJson(req.body.endLocation, null);

    let evidence = null;
    if (req.file) {
      evidence = await saveImage({ file: req.file, sessionId, staffId, kind: 'END_SPEEDOMETER', location: endLocation });
    }

    // NLP summarization
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

    const caseIds = (session.cases && session.cases.length ? session.cases.map((c) => c.assignmentId) : [session.assignmentId]);
    await Assignment.updateMany(
      { _id: { $in: caseIds } },
      { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: endTime }
    );

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSession error:', error.message);
    return fail(res, 500, errorMessage(error, 'Could not submit the recovery. Please try again.'));
  }
};

// GET /recovery/history — returns all completed sessions for this staff member
exports.getHistory = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database not connected.');
    const staffId = req.staff._id.toString();

    const sessions = await RecoverySession.find({ staffId, status: 'COMPLETED' })
      .sort({ endTime: -1 })
      .limit(100)
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
    const staffId = req.staff._id.toString();
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

    // We need at least one valid assignmentId — use a placeholder if offline session has none
    let assignmentId = body.assignmentId;
    let customerId = body.customerId;
    let loanId = body.loanId;

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      // Offline session without real assignment — find the first assignment for this staff
      const fallback = await Assignment.findOne({ staffId }).lean();
      if (!fallback) return fail(res, 400, 'No assignment found for this staff member to link the offline session.');
      assignmentId = fallback._id;
      customerId = fallback.customerId;
      loanId = fallback.loanId;
    }

    const session = await RecoverySession.create({
      sessionId,
      deviceSessionId,
      staffId,
      assignmentId,
      customerId: customerId || assignmentId,
      loanId: loanId || assignmentId,
      startTime: body.startTime ? new Date(body.startTime) : new Date(),
      endTime: body.endTime ? new Date(body.endTime) : new Date(),
      status: 'COMPLETED',
      outcome: body.outcome || 'FOLLOW_UP_REQUIRED',
      vehicleType: body.vehicleType || '',
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

    return res.status(201).json({ success: true, session });
  } catch (error) {
    console.error('syncOfflineSession error:', error.message);
    return fail(res, 500, 'Could not sync offline session.');
  }
};

// POST /recovery/sessions/:sessionId/finish-walk  (JSON body, no photo — Walk mode)
exports.finishSessionWalk = async (req, res) => {
  try {
    if (!getIsConnected()) return fail(res, 503, 'Database not connected.');
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();

    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) return fail(res, 400, 'Remarks are required.');

    const session = await RecoverySession.findOne({ sessionId, staffId });
    if (!session) return fail(res, 404, 'Recovery session not found.');
    if (session.status !== 'ACTIVE') return fail(res, 409, 'This recovery is already finished.');

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
      : [session.assignmentId]);
    await Assignment.updateMany(
      { _id: { $in: caseIds } },
      { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: endTime }
    );

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSessionWalk error:', error.message);
    return fail(res, 500, 'Could not submit the recovery.');
  }
};
