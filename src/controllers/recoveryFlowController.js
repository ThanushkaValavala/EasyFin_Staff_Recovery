const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');





const { getIsConnected } = require('../config/db');
const rules = require('../services/recoveryRules');
const { summarize } = require('../services/nlpSummarizer');

const fail = (res, code, message) => res.status(code).json({ success: false, message });

const parseJson = (v, fallback) => {
  if (v && typeof v === 'object') return v;
  try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
};

const saveImage = ({ file, sessionId, staffId, agentId, kind, location, models }) => {
  const actualAgentId = agentId || staffId;
  const evidenceId = `EVID-${Date.now()}-${uuidv4().substring(0, 6)}`;
  const EvidenceModel = models && models.Evidence;
  return EvidenceModel.create({
    evidenceId,
    sessionId,
    agentId: actualAgentId,
    staffId: actualAgentId,
    kind,
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
// Uses atomic check-and-set on session.statsIncremented to prevent duplicate counts
async function incrementAgentStats(agentId, distanceMeters, session, models) {
  try {
    const RecoverySessionModel = models && models.RecoverySession;
    const StaffModel = models && models.Staff;
    const sessionDoc = await RecoverySessionModel.findOne({ _id: session._id });
    if (sessionDoc && sessionDoc.statsIncremented) {
      return; // Already incremented!
    }

    const updateRes = await RecoverySessionModel.updateOne(
      { _id: session._id, statsIncremented: { $ne: true } },
      { $set: { statsIncremented: true } }
    );
    if (updateRes.modifiedCount === 0) {
      return; // Concurrent race prevented
    }

    const distanceKm = Number(distanceMeters) / 1000 || 0;
    const sessionIdForHistory = session.sessionId || session._id.toString();

    await StaffModel.findOneAndUpdate(
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
    console.error('[incrementAgentStats] Failed to update agent stats:', err.message);
  }
}

// POST /recovery/start-with-photo (multipart: startPhoto + fields, or JSON for WALK/OTHER)
exports.startWithPhoto = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  let evidence = null;
  let session = null;
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database is not connected. Try again shortly.');

    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    // Transport mode: WALK, BIKE, CAR, OTHER
    const vehicleTypeRaw = String(req.body.vehicleType || req.body.transportMode || '').toUpperCase().trim();
    const isWalkLike = vehicleTypeRaw === 'WALK' || vehicleTypeRaw === 'OTHER';
    const needsPhoto = vehicleTypeRaw === 'BIKE' || vehicleTypeRaw === 'CAR';

    // Vehicle validation for Bike/Car
    let vehicleNumber = '';
    if (needsPhoto) {
      const vehicle = rules.validateVehicle(vehicleTypeRaw, req.body.vehicleNumber);
      if (vehicle && vehicle.error) return fail(res, 400, vehicle.error);
      vehicleNumber = (vehicle && vehicle.vehicleNumber) || String(req.body.vehicleNumber || '').trim().toUpperCase();
      if (!req.file) return fail(res, 400, 'Starting speedometer photo is required for Bike/Car.');
    } else if (!isWalkLike) {
      return fail(res, 400, 'Invalid transport mode. Must be WALK, BIKE, CAR, or OTHER.');
    }

    const deviceSessionId = String(req.body.deviceSessionId || '').trim();

    // Idempotency check: return existing if deviceSessionId was already started
    if (deviceSessionId) {
      const existing = await RecoverySession.findOne({ deviceSessionId });
      if (existing) {
        return res.status(200).json({ success: true, message: 'Session already started.', session: existing });
      }
    }

    // Check for existing active session for this agent
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
        await Assignment.updateMany({ _id: { $in: ids }, $or: [{ agentId }, { staffId }] }, { recoveryStatus: 'IN_PROGRESS', lastVisitDate: new Date() });
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

    if (!assignmentId) {
      assignmentId = agentId;
      customerId = agentId;
      loanId = agentId;
      cases = [];
    }

    const sessionId = `SESS-${Date.now()}-${uuidv4().substring(0, 8)}`;

    if (req.file) {
      evidence = await saveImage({
        file: req.file, sessionId, staffId, agentId, kind: 'START_SPEEDOMETER', location: initialLocation, models: req.models
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
        pointId: `${sessionId}_init_${Date.now()}`,
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

// POST /recovery/sessions/:sessionId/finish (multipart: endPhoto + remarks)
exports.finishSession = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database is not connected. Try again shortly.');
    const { sessionId } = req.params;
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) return fail(res, 400, 'Remarks are required.');

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId }]
    });
    if (!session) return fail(res, 404, 'Recovery session not found or access denied.');
    if (session.status !== 'ACTIVE') {
      // Idempotent — already finished
      return res.status(200).json({ success: true, message: 'This recovery is already finished.', session });
    }

    // Only BIKE and CAR require end photo; WALK and OTHER do not
    const vehicleType = String(session.vehicleType || '').toUpperCase();
    const needsEndPhoto = vehicleType === 'BIKE' || vehicleType === 'CAR';
    if (needsEndPhoto && !req.file) return fail(res, 400, 'Ending speedometer photo is required.');

    const endLocation = parseJson(req.body.endLocation, null);

    let evidence = null;
    if (req.file) {
      evidence = await saveImage({ file: req.file, sessionId, staffId, agentId, kind: 'END_SPEEDOMETER', location: endLocation, models: req.models });
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
    if (req.body.movingSeconds !== undefined && req.body.movingSeconds !== null && req.body.movingSeconds !== '') {
      session.movingSeconds = Number(req.body.movingSeconds);
    }
    if (req.body.idleSeconds !== undefined && req.body.idleSeconds !== null && req.body.idleSeconds !== '') {
      session.idleSeconds = Number(req.body.idleSeconds);
    }
    if (req.body.unknownSeconds !== undefined && req.body.unknownSeconds !== null && req.body.unknownSeconds !== '') {
      session.unknownSeconds = Number(req.body.unknownSeconds);
    }
    if (req.body.startAddress !== undefined && req.body.startAddress !== null) {
      session.startAddress = String(req.body.startAddress).trim().slice(0, 300);
    }
    if (req.body.endAddress !== undefined && req.body.endAddress !== null) {
      session.endAddress = String(req.body.endAddress).trim().slice(0, 300);
    }
    const finalLocation = rules.pickLocation(endLocation);
    if (finalLocation) session.endLocation = finalLocation;
    await session.save();

    // Update assignments verifying agent ownership
    const caseIds = (session.cases && session.cases.length
      ? session.cases.map((c) => c.assignmentId)
      : [session.assignmentId]).filter(Boolean);
    if (caseIds.length) {
      await Assignment.updateMany(
        { _id: { $in: caseIds }, $or: [{ agentId }, { staffId }] },
        { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: endTime }
      ).catch(() => {});
    }

    // Atomically increment agent stats (duplicate-safe)
    await incrementAgentStats(agentId, session.distanceMeters, session, req.models);

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSession error:', error.message);
    return fail(res, 500, errorMessage(error, 'Could not submit the recovery. Please try again.'));
  }
};

// POST /recovery/sessions/:sessionId/finish-walk (JSON body, no photo — Walk & Other modes)
exports.finishSessionWalk = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const { sessionId } = req.params;
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId }]
    });
    if (!session) return fail(res, 404, 'Recovery session not found or access denied.');
    if (session.status !== 'ACTIVE') {
      return res.status(200).json({ success: true, message: 'This recovery is already finished.', session });
    }

    // Strict validation: BIKE and CAR must not bypass photo via finish-walk
    const vehicleType = String(session.vehicleType || '').toUpperCase();
    if (vehicleType === 'BIKE' || vehicleType === 'CAR') {
      return fail(res, 400, 'Ending speedometer photo is required for Bike/Car recovery. Use the finish endpoint with photo.');
    }

    const remarks = String(req.body.remarks || '').trim();
    if (!remarks) return fail(res, 400, 'Remarks are required.');

    const endLocation = parseJson(req.body.endLocation, null);
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
    if (req.body.movingSeconds !== undefined && req.body.movingSeconds !== null && req.body.movingSeconds !== '') {
      session.movingSeconds = Number(req.body.movingSeconds);
    }
    if (req.body.idleSeconds !== undefined && req.body.idleSeconds !== null && req.body.idleSeconds !== '') {
      session.idleSeconds = Number(req.body.idleSeconds);
    }
    if (req.body.unknownSeconds !== undefined && req.body.unknownSeconds !== null && req.body.unknownSeconds !== '') {
      session.unknownSeconds = Number(req.body.unknownSeconds);
    }
    if (req.body.startAddress !== undefined && req.body.startAddress !== null) {
      session.startAddress = String(req.body.startAddress).trim().slice(0, 300);
    }
    if (req.body.endAddress !== undefined && req.body.endAddress !== null) {
      session.endAddress = String(req.body.endAddress).trim().slice(0, 300);
    }
    const finalLocation = rules.pickLocation(endLocation);
    if (finalLocation) session.endLocation = finalLocation;
    await session.save();

    const caseIds = (session.cases && session.cases.length
      ? session.cases.map((c) => c.assignmentId)
      : [session.assignmentId]).filter(Boolean);
    if (caseIds.length) {
      await Assignment.updateMany(
        { _id: { $in: caseIds }, $or: [{ agentId }, { staffId }] },
        { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: endTime }
      ).catch(() => {});
    }

    // Atomically increment agent stats
    await incrementAgentStats(agentId, session.distanceMeters, session, req.models);

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSessionWalk error:', error.message);
    return fail(res, 500, 'Could not submit the recovery.');
  }
};

// GET /recovery/history — returns all completed sessions for this agent (excluding rawRemarks)
exports.getHistory = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    const sessions = await RecoverySession.find({
      $or: [{ agentId }, { staffId }],
      status: 'COMPLETED'
    })
      .sort({ endTime: -1 })
      .limit(200)
      .select('-rawRemarks -remarks -visitNotes') // Do NOT expose raw remarks to frontend
      .lean();

    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    console.error('getHistory error:', error.message);
    return fail(res, 500, 'Could not fetch history.');
  }
};

// POST /recovery/sync — accepts a completed offline session and saves/reconciles it
exports.syncOfflineSession = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();
    const body = req.body || {};

    const deviceSessionId = String(body.deviceSessionId || '').trim();
    if (!deviceSessionId) return fail(res, 400, 'deviceSessionId is required for sync.');

    // Look for files uploaded via multipart fields
    const startPhotoFile = (req.files && req.files.startPhoto && req.files.startPhoto[0]) ||
      (req.file && req.file.fieldname === 'startPhoto' ? req.file : null);
    const endPhotoFile = (req.files && req.files.endPhoto && req.files.endPhoto[0]) ||
      (req.file && req.file.fieldname === 'endPhoto' ? req.file : null);

    // ── CASE 1: Session already exists in DB ──────────────────────────────────
    const existing = await RecoverySession.findOne({ deviceSessionId });
    if (existing) {
      if (existing.status === 'COMPLETED') {
        // Idempotency: already synced and completed
        return res.status(200).json({ success: true, alreadySynced: true, session: existing });
      }

      // Session exists but was ACTIVE (started online, finished offline)
      const vehicleType = String(existing.vehicleType || '').toUpperCase();
      const needsPhoto = vehicleType === 'BIKE' || vehicleType === 'CAR';

      if (needsPhoto && !endPhotoFile && !existing.endSpeedometerEvidenceId) {
        return fail(res, 400, 'Ending speedometer photo is required to finish BIKE/CAR recovery.');
      }

      const endLoc = parseJson(body.endLocation, null);
      if (endPhotoFile) {
        const endEv = await saveImage({
          file: endPhotoFile,
          sessionId: existing.sessionId,
          staffId,
          agentId,
          kind: 'END_SPEEDOMETER',
          location: endLoc,
          models: req.models
        });
        existing.endSpeedometerEvidenceId = endEv.evidenceId;
      }

      const remarks = String(body.remarks || body.rawRemarks || existing.remarks || '').trim();
      if (!remarks) return fail(res, 400, 'Customer visit remarks are required.');

      const { nlpSummary, nlpCategory } = summarize(remarks);
      existing.endTime = body.endTime ? new Date(body.endTime) : new Date();
      existing.status = 'COMPLETED';
      existing.remarks = remarks;
      existing.rawRemarks = remarks;
      existing.visitNotes = remarks;
      existing.nlpSummary = nlpSummary;
      existing.nlpCategory = nlpCategory;
      if (body.durationSeconds !== undefined) existing.durationSeconds = Number(body.durationSeconds) || 0;
      if (body.distanceMeters !== undefined) existing.distanceMeters = Number(body.distanceMeters) || 0;
      if (body.movingSeconds !== undefined && body.movingSeconds !== null && body.movingSeconds !== '') {
        existing.movingSeconds = Number(body.movingSeconds);
      }
      if (body.idleSeconds !== undefined && body.idleSeconds !== null && body.idleSeconds !== '') {
        existing.idleSeconds = Number(body.idleSeconds);
      }
      if (body.unknownSeconds !== undefined && body.unknownSeconds !== null && body.unknownSeconds !== '') {
        existing.unknownSeconds = Number(body.unknownSeconds);
      }
      if (body.startAddress !== undefined && body.startAddress !== null) {
        existing.startAddress = String(body.startAddress).trim().slice(0, 300);
      }
      if (body.endAddress !== undefined && body.endAddress !== null) {
        existing.endAddress = String(body.endAddress).trim().slice(0, 300);
      }
      const finalLoc = rules.pickLocation(endLoc);
      if (finalLoc) existing.endLocation = finalLoc;

      await existing.save();

      // Persist any tracking points passed in sync payload
      const rawPoints = parseJson(body.points, []);
      if (Array.isArray(rawPoints) && rawPoints.length > 0) {
        const ptDocs = rawPoints.map(p => ({
          sessionId: existing.sessionId,
          agentId,
          staffId,
          pointId: p.pointId || `${existing.sessionId}_${new Date(p.timestamp || Date.now()).getTime()}_${Number(p.latitude).toFixed(6)}_${Number(p.longitude).toFixed(6)}`,
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          accuracy: Number(p.accuracy) || 0,
          altitude: Number(p.altitude) || 0,
          speed: Number(p.speed) || 0,
          timestamp: p.timestamp ? new Date(p.timestamp) : new Date()
        }));
        try {
          await TrackingPoint.insertMany(ptDocs, { ordered: false });
        } catch (pe) {
          if (pe.code !== 11000 && !pe.writeErrors?.every(e => e.code === 11000)) throw pe;
        }
      }

      await incrementAgentStats(agentId, existing.distanceMeters, existing, req.models);
      return res.status(200).json({ success: true, session: existing });
    }

    // ── CASE 2: Entirely offline session creation ───────────────────────────
    const vehicleTypeRaw = String(body.vehicleType || body.transportMode || 'WALK').toUpperCase().trim();
    const isWalkLike = vehicleTypeRaw === 'WALK' || vehicleTypeRaw === 'OTHER';
    const needsPhotos = vehicleTypeRaw === 'BIKE' || vehicleTypeRaw === 'CAR';

    if (!isWalkLike && !needsPhotos) {
      return fail(res, 400, 'Invalid transport mode. Must be WALK, BIKE, CAR, or OTHER.');
    }

    let vehicleNumber = '';
    if (needsPhotos) {
      const vCheck = rules.validateVehicle(vehicleTypeRaw, body.vehicleNumber);
      if (vCheck.error) return fail(res, 400, vCheck.error);
      vehicleNumber = vCheck.vehicleNumber;

      if (!startPhotoFile) {
        return fail(res, 400, 'Starting speedometer photo is mandatory for BIKE and CAR offline synchronization.');
      }
      if (!endPhotoFile) {
        return fail(res, 400, 'Ending speedometer photo is mandatory for BIKE and CAR offline synchronization.');
      }
    }

    const remarks = String(body.remarks || body.rawRemarks || '').trim();
    if (!remarks) return fail(res, 400, 'Customer visit remarks are required.');

    const sessionId = (body.sessionId && String(body.sessionId).startsWith('SESS-'))
      ? String(body.sessionId)
      : `SESS-SYNC-${Date.now()}-${uuidv4().substring(0, 8)}`;

    const startLoc = parseJson(body.startLocation, null);
    const endLoc = parseJson(body.endLocation, null);

    let startEvidence = null;
    let endEvidence = null;

    if (startPhotoFile) {
      startEvidence = await saveImage({
        file: startPhotoFile,
        sessionId,
        staffId,
        agentId,
        kind: 'START_SPEEDOMETER',
        location: startLoc,
        models: req.models
      });
    }

    if (endPhotoFile) {
      endEvidence = await saveImage({
        file: endPhotoFile,
        sessionId,
        staffId,
        agentId,
        kind: 'END_SPEEDOMETER',
        location: endLoc,
        models: req.models
      });
    }

    const { nlpSummary, nlpCategory } = summarize(remarks);

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
      vehicleType: vehicleTypeRaw,
      vehicleNumber,
      durationSeconds: Number(body.durationSeconds) || 0,
      distanceMeters: Number(body.distanceMeters) || 0,
      movingSeconds: (body.movingSeconds !== undefined && body.movingSeconds !== null && body.movingSeconds !== '') ? Number(body.movingSeconds) : null,
      idleSeconds: (body.idleSeconds !== undefined && body.idleSeconds !== null && body.idleSeconds !== '') ? Number(body.idleSeconds) : null,
      unknownSeconds: (body.unknownSeconds !== undefined && body.unknownSeconds !== null && body.unknownSeconds !== '') ? Number(body.unknownSeconds) : null,
      startAddress: body.startAddress ? String(body.startAddress).trim().slice(0, 300) : '',
      endAddress: body.endAddress ? String(body.endAddress).trim().slice(0, 300) : '',
      remarks,
      rawRemarks: remarks,
      visitNotes: remarks,
      nlpSummary,
      nlpCategory,
      startSpeedometerEvidenceId: startEvidence ? startEvidence.evidenceId : '',
      endSpeedometerEvidenceId: endEvidence ? endEvidence.evidenceId : '',
      startLocation: rules.pickLocation(startLoc),
      endLocation: rules.pickLocation(endLoc),
      area: body.area || '',
    });

    // Persist GPS tracking points
    const rawPoints = parseJson(body.points, []);
    if (Array.isArray(rawPoints) && rawPoints.length > 0) {
      const ptDocs = rawPoints.map(p => ({
        sessionId,
        agentId,
        staffId,
        pointId: p.pointId || `${sessionId}_${new Date(p.timestamp || Date.now()).getTime()}_${Number(p.latitude).toFixed(6)}_${Number(p.longitude).toFixed(6)}`,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        accuracy: Number(p.accuracy) || 0,
        altitude: Number(p.altitude) || 0,
        speed: Number(p.speed) || 0,
        timestamp: p.timestamp ? new Date(p.timestamp) : new Date()
      }));
      try {
        await TrackingPoint.insertMany(ptDocs, { ordered: false });
      } catch (pe) {
        if (pe.code !== 11000 && !pe.writeErrors?.every(e => e.code === 11000)) throw pe;
      }
    }

    // Verify assignment ownership on update
    if (assignmentId && assignmentId !== agentId) {
      await Assignment.updateOne(
        { _id: assignmentId, $or: [{ agentId }, { staffId }] },
        { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: session.endTime }
      ).catch(() => {});
    }

    // Atomically increment agent stats
    await incrementAgentStats(agentId, session.distanceMeters, session, req.models);

    return res.status(201).json({ success: true, session });
  } catch (error) {
    console.error('syncOfflineSession error:', error.message);
    return fail(res, 500, errorMessage(error, 'Could not sync offline session.'));
  }
};

// GET /recovery/stats — returns agent's recovery statistics
exports.getAgentStats = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
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
