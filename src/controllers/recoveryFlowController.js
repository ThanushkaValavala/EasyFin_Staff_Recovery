const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const { getIsConnected } = require('../config/db');
const rules = require('../services/recoveryRules');
const { summarize } = require('../services/nlpSummarizer');
const storage = require('../services/storage');

const PHOTO_BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'photos';
const VOICE_BUCKET = process.env.SUPABASE_VOICE_BUCKET || 'voices';

const fail = (res, code, message) => res.status(code).json({ success: false, message });

const parseJson = (v, fallback) => {
  if (v && typeof v === 'object') return v;
  try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
};

/**
 * Parse and validate the customerMet block from a request body.
 * Returns { ok: true, customerMet, customerNames, metAt, notMetReason }
 * or      { ok: false, status, message } on validation failure.
 * Returns { ok: null } when customerMet is absent (older-app path).
 *
 * hasVoice: true when a voice file is present (satisfies notMet requirement).
 */
const parseCustomerMetBlock = (body, hasVoice = false) => {
  const rawCm = body.customerMet;
  if (rawCm === undefined || rawCm === null || rawCm === '') return { ok: null };

  let customerMet;
  if (rawCm === true  || rawCm === 'true')  customerMet = true;
  else if (rawCm === false || rawCm === 'false') customerMet = false;
  else return { ok: false, status: 400, message: 'customerMet must be true or false.' };

  // customerNames: accept JSON string or array; trim; drop empties; cap at 5; each max 60 chars
  let rawNames = parseJson(body.customerNames, body.customerNames);
  if (!Array.isArray(rawNames)) rawNames = rawNames ? [String(rawNames)] : [];
  const customerNames = rawNames
    .map((n) => String(n).trim().slice(0, 60))
    .filter((n) => n.length > 0)
    .slice(0, 5);

  // metAt: valid date only
  let metAt = null;
  if (body.metAt !== undefined && body.metAt !== null && body.metAt !== '') {
    const d = new Date(body.metAt);
    if (isNaN(d.getTime())) return { ok: false, status: 400, message: 'metAt must be a valid date.' };
    metAt = d;
  }

  // notMetReason: trimmed, max 300 chars
  const notMetReason = String(body.notMetReason || '').trim().slice(0, 300);

  // Business rules
  if (customerMet === true && customerNames.length === 0) {
    return { ok: false, status: 400, message: 'At least one customer name is required when customerMet is true.' };
  }
  // Not met: valid if notMetReason provided OR a voice note uploaded
  if (customerMet === false && notMetReason.length === 0 && !hasVoice) {
    return { ok: false, status: 400, message: 'notMetReason or a voice note is required when customerMet is false.' };
  }

  return { ok: true, customerMet, customerNames, metAt, notMetReason };
};

/**
 * Save a speedometer image. Try Supabase first; fall back to MongoDB binary.
 * Never throws — on Supabase failure falls back silently to mongo buffer storage.
 */
const saveImage = async ({ file, sessionId, branchSlug, staffId, agentId, kind, location, models }) => {
  const actualAgentId = agentId || staffId;
  const evidenceId = `EVID-${Date.now()}-${uuidv4().substring(0, 6)}`;
  const EvidenceModel = models && models.Evidence;

  let storagePath = '';
  let fileData = file.buffer; // default: store in mongo

  // Try Supabase upload
  try {
    const slug = branchSlug || 'default';
    const remotePath = `${slug}/${sessionId}/${kind.toLowerCase()}-${evidenceId}.jpg`;
    await storage.uploadFile(PHOTO_BUCKET, remotePath, file.buffer, file.mimetype || 'image/jpeg');
    storagePath = remotePath;
    fileData = undefined; // don't store binary in mongo when Supabase succeeds
  } catch (_err) {
    // Supabase unavailable — fall back to mongo binary (current behaviour)
    storagePath = '';
    fileData = file.buffer;
  }

  return EvidenceModel.create({
    evidenceId,
    sessionId,
    agentId: actualAgentId,
    staffId: actualAgentId,
    kind,
    fileName: `${kind.toLowerCase()}-${evidenceId}.jpg`,
    originalName: file.originalname || 'photo.jpg',
    filePath: `/api/v1/recovery/evidence/${evidenceId}/image`,
    storagePath,
    fileSize: file.size,
    mimeType: file.mimetype,
    caption: kind === 'START_SPEEDOMETER' ? 'Starting speedometer' : 'Ending speedometer',
    latitude: Number(location && location.latitude) || 0,
    longitude: Number(location && location.longitude) || 0,
    data: fileData,
  });
};

const getAudioContentTypeFromFilename = (filename) => {
  const match = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match ? `.${match[1]}` : '';
  switch (ext) {
    case '.m4a':
    case '.mp4':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.caf':
      return 'audio/x-caf';
    default:
      return 'audio/mp4';
  }
};

const resolveVoiceContentType = (voiceFile) => {
  const rawType = (voiceFile && voiceFile.mimetype ? String(voiceFile.mimetype).trim().toLowerCase() : '');
  const isMissing = !rawType;
  const isOctetStream = rawType === 'application/octet-stream';
  const isM4aVariant = rawType === 'audio/m4a' ||
    rawType === 'audio/x-m4a' ||
    rawType === 'audio/mp4' ||
    rawType === 'audio/mp4a-latm' ||
    rawType.startsWith('audio/m4a;') ||
    rawType.startsWith('audio/x-m4a;') ||
    rawType.startsWith('audio/mp4;') ||
    rawType.startsWith('audio/mp4a-latm;');

  if (isMissing || isOctetStream || isM4aVariant) {
    const filename = (voiceFile && (voiceFile.originalname || voiceFile.name || voiceFile.filename)) || '';
    return getAudioContentTypeFromFilename(filename);
  }
  return rawType;
};

const logVoiceUploadError = (err) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || (err && err.message === 'Supabase not configured')) {
    console.error('[voice] storage not configured');
    return;
  }
  const errObj = (err instanceof Error)
    ? err
    : (err && err.error instanceof Error)
      ? err.error
      : null;
  const errName = (errObj && errObj.name) || (err && err.name) || 'Error';
  const rawMsg = (errObj && errObj.message) || (err && (err.message || err.error_description)) || (typeof err === 'string' ? err : 'Upload failed');
  const errMsg = String(rawMsg).slice(0, 120);
  console.error(`[voice] upload failed: ${errName}: ${errMsg}`);
};

/**
 * Upload voice file to Supabase.
 * Returns { success: true, voicePath } on success,
 *         { success: false } on failure (never throws).
 */
const saveVoice = async (voiceFile, sessionId, branchSlug) => {
  if (!voiceFile) return null;
  try {
    const slug = branchSlug || 'default';
    const remotePath = `${slug}/${sessionId}/voice.m4a`;
    const contentType = resolveVoiceContentType(voiceFile);

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      logVoiceUploadError(new Error('Supabase not configured'));
      return { success: false };
    }

    const uploadRes = await storage.uploadFile(VOICE_BUCKET, remotePath, voiceFile.buffer, contentType);
    if (!uploadRes || uploadRes instanceof Error || uploadRes.error || uploadRes.success === false) {
      logVoiceUploadError(uploadRes);
      return { success: false };
    }

    return { success: true, voicePath: remotePath };
  } catch (err) {
    logVoiceUploadError(err);
    return { success: false };
  }
};

const errorMessage = (error, fallback) =>
  error && error.name === 'ValidationError' ? error.message : fallback;

// Atomically increment agent statistics after a successful recovery
async function incrementAgentStats(agentId, distanceMeters, session, models) {
  try {
    const RecoverySessionModel = models && models.RecoverySession;
    const StaffModel = models && models.Staff;
    const sessionDoc = await RecoverySessionModel.findOne({ _id: session._id });
    if (sessionDoc && sessionDoc.statsIncremented) {
      return;
    }

    const updateRes = await RecoverySessionModel.updateOne(
      { _id: session._id, statsIncremented: { $ne: true } },
      { $set: { statsIncremented: true } }
    );
    if (updateRes.modifiedCount === 0) {
      return;
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

// Derive a URL-safe branch slug from req.branch (e.g. "Branch 1" -> "branch-1")
function branchSlug(req) {
  return String(req.branch || 'default').toLowerCase().replace(/\s+/g, '-');
}

// POST /recovery/start-with-photo
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

    if (deviceSessionId) {
      const existing = await RecoverySession.findOne({ deviceSessionId });
      if (existing) {
        return res.status(200).json({ success: true, message: 'Session already started.', session: existing });
      }
    }

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

    // plannedLocation, plannedPersonCount, plannedNames (new optional fields)
    const plannedLocation = parseJson(req.body.plannedLocation, null);
    const plannedPersonCount = req.body.plannedPersonCount !== undefined ? Number(req.body.plannedPersonCount) || 0 : undefined;
    let rawPlannedNames = parseJson(req.body.plannedNames, req.body.plannedNames);
    if (!Array.isArray(rawPlannedNames)) rawPlannedNames = rawPlannedNames ? [String(rawPlannedNames)] : [];
    const plannedNames = rawPlannedNames
      .map((n) => String(n).trim().slice(0, 60))
      .filter((n) => n.length > 0)
      .slice(0, 10);

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
    const slug = branchSlug(req);

    if (req.file) {
      evidence = await saveImage({
        file: req.file, sessionId, branchSlug: slug, staffId, agentId, kind: 'START_SPEEDOMETER', location: initialLocation, models: req.models
      });
    }

    // Build planned fields object (only include if provided)
    const plannedFields = {};
    if (plannedLocation && (plannedLocation.latitude || plannedLocation.name)) {
      plannedFields.plannedLocation = {
        name: String(plannedLocation.name || '').trim().slice(0, 200),
        latitude: Number(plannedLocation.latitude) || 0,
        longitude: Number(plannedLocation.longitude) || 0,
      };
    }
    if (plannedPersonCount !== undefined) plannedFields.plannedPersonCount = plannedPersonCount;
    if (plannedNames.length > 0) plannedFields.plannedNames = plannedNames;

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
      ...plannedFields,
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

// POST /recovery/sessions/:sessionId/finish
exports.finishSession = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database is not connected. Try again shortly.');
    const { sessionId } = req.params;
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    // Voice file (optional)
    const voiceFile = req.files && req.files.voice && req.files.voice[0];
    const hasVoice = Boolean(voiceFile);
    console.log(`[voice] file received: ${hasVoice ? 'yes' : 'no'}, ${hasVoice ? (voiceFile.size || 0) : 0} bytes, ${hasVoice ? (voiceFile.mimetype || 'none') : 'none'}`);

    // ── customerMet block ─────────────────────────────────────────────────────
    const cmBlock = parseCustomerMetBlock(req.body, hasVoice);
    if (cmBlock.ok === false) return fail(res, cmBlock.status, cmBlock.message);

    // Older-app path: customerMet absent → remarks required
    const remarks = String(req.body.remarks || '').trim();
    if (cmBlock.ok === null && !remarks) return fail(res, 400, 'Remarks are required.');

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId }]
    });
    if (!session) return fail(res, 404, 'Recovery session not found or access denied.');
    if (session.status !== 'ACTIVE') {
      return res.status(200).json({ success: true, message: 'This recovery is already finished.', session });
    }

    // Only BIKE and CAR require end photo
    const vehicleType = String(session.vehicleType || '').toUpperCase();
    const needsEndPhoto = vehicleType === 'BIKE' || vehicleType === 'CAR';

    // endPhoto comes via req.file (set by safeFinishWithVoice) or req.files.endPhoto
    const endPhotoFile = req.file ||
      (req.files && req.files.endPhoto && req.files.endPhoto[0]);
    if (needsEndPhoto && !endPhotoFile) return fail(res, 400, 'Ending speedometer photo is required.');

    const endLocation = parseJson(req.body.endLocation, null);
    const slug = branchSlug(req);

    // Voice upload BEFORE anything is persisted (Evidence, NLP, session fields, stats)
    let voiceResult = null;
    if (hasVoice) {
      voiceResult = await saveVoice(voiceFile, sessionId, slug);
      if (!voiceResult || !voiceResult.success) {
        return res.status(503).json({ success: false, message: 'Voice note could not be saved. Please try again.' });
      }
    }

    let evidence = null;
    if (endPhotoFile) {
      evidence = await saveImage({ file: endPhotoFile, sessionId, branchSlug: slug, staffId, agentId, kind: 'END_SPEEDOMETER', location: endLocation, models: req.models });
    }

    const endTime = new Date();
    session.endTime = endTime;
    session.status = 'COMPLETED';

    if (cmBlock.ok === true) {
      session.customerMet = cmBlock.customerMet;
      session.customerNames = cmBlock.customerNames;
      session.metAt = cmBlock.metAt;
      session.notMetReason = cmBlock.notMetReason;
    } else {
      let nlpSummary, nlpCategory, nlpDetails;
      try {
        ({ nlpSummary, nlpCategory, nlpDetails } = summarize(remarks));
      } catch (_e) {
        nlpSummary = ''; nlpCategory = 'GENERAL';
        nlpDetails = { names: [], amounts: [], dates: [], phones: [], keyPoints: [] };
      }
      session.remarks = remarks;
      session.rawRemarks = remarks;
      session.visitNotes = remarks;
      session.nlpSummary = nlpSummary;
      session.nlpCategory = nlpCategory;
      session.nlpDetails = nlpDetails;
    }

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

    if (voiceResult && voiceResult.voicePath) {
      session.voicePath = voiceResult.voicePath;
      if (req.body.voiceDurationSeconds !== undefined) {
        session.voiceDurationSeconds = Number(req.body.voiceDurationSeconds) || 0;
      }
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

    await incrementAgentStats(agentId, session.distanceMeters, session, req.models);

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSession error:', error.message);
    return fail(res, 500, errorMessage(error, 'Could not submit the recovery. Please try again.'));
  }
};

// POST /recovery/sessions/:sessionId/finish-walk
exports.finishSessionWalk = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const { sessionId } = req.params;
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    // Voice file (optional)
    const voiceFile = req.files && req.files.voice && req.files.voice[0];
    const hasVoice = Boolean(voiceFile);
    console.log(`[voice] file received: ${hasVoice ? 'yes' : 'no'}, ${hasVoice ? (voiceFile.size || 0) : 0} bytes, ${hasVoice ? (voiceFile.mimetype || 'none') : 'none'}`);

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId }]
    });
    if (!session) return fail(res, 404, 'Recovery session not found or access denied.');
    if (session.status !== 'ACTIVE') {
      return res.status(200).json({ success: true, message: 'This recovery is already finished.', session });
    }

    const vehicleType = String(session.vehicleType || '').toUpperCase();
    if (vehicleType === 'BIKE' || vehicleType === 'CAR') {
      return fail(res, 400, 'Ending speedometer photo is required for Bike/Car recovery. Use the finish endpoint with photo.');
    }

    // ── customerMet block ─────────────────────────────────────────────────────
    const cmBlock = parseCustomerMetBlock(req.body, hasVoice);
    if (cmBlock.ok === false) return fail(res, cmBlock.status, cmBlock.message);

    const remarks = String(req.body.remarks || '').trim();
    if (cmBlock.ok === null && !remarks) return fail(res, 400, 'Remarks are required.');

    const endLocation = parseJson(req.body.endLocation, null);
    const slug = branchSlug(req);

    // Voice upload BEFORE anything is persisted (NLP, session fields, stats)
    let voiceResult = null;
    if (hasVoice) {
      voiceResult = await saveVoice(voiceFile, sessionId, slug);
      if (!voiceResult || !voiceResult.success) {
        return res.status(503).json({ success: false, message: 'Voice note could not be saved. Please try again.' });
      }
    }

    const endTime = new Date();
    session.endTime = endTime;
    session.status = 'COMPLETED';

    if (cmBlock.ok === true) {
      session.customerMet = cmBlock.customerMet;
      session.customerNames = cmBlock.customerNames;
      session.metAt = cmBlock.metAt;
      session.notMetReason = cmBlock.notMetReason;
    } else {
      let nlpSummary, nlpCategory, nlpDetails;
      try {
        ({ nlpSummary, nlpCategory, nlpDetails } = summarize(remarks));
      } catch (_e) {
        nlpSummary = ''; nlpCategory = 'GENERAL';
        nlpDetails = { names: [], amounts: [], dates: [], phones: [], keyPoints: [] };
      }
      session.remarks = remarks;
      session.rawRemarks = remarks;
      session.visitNotes = remarks;
      session.nlpSummary = nlpSummary;
      session.nlpCategory = nlpCategory;
      session.nlpDetails = nlpDetails;
    }

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

    if (voiceResult && voiceResult.voicePath) {
      session.voicePath = voiceResult.voicePath;
      if (req.body.voiceDurationSeconds !== undefined) {
        session.voiceDurationSeconds = Number(req.body.voiceDurationSeconds) || 0;
      }
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

    await incrementAgentStats(agentId, session.distanceMeters, session, req.models);

    return res.status(200).json({ success: true, message: 'Recovery submitted.', session });
  } catch (error) {
    console.error('finishSessionWalk error:', error.message);
    return fail(res, 500, 'Could not submit the recovery.');
  }
};

// GET /recovery/history
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
      .select('-rawRemarks -remarks -visitNotes')
      .lean();

    return res.status(200).json({ success: true, sessions });
  } catch (error) {
    console.error('getHistory error:', error.message);
    return fail(res, 500, 'Could not fetch history.');
  }
};

// POST /recovery/sync
exports.syncOfflineSession = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();
    const body = req.body || {};

    const deviceSessionId = String(body.deviceSessionId || '').trim();
    if (!deviceSessionId) return fail(res, 400, 'deviceSessionId is required for sync.');

    const startPhotoFile = (req.files && req.files.startPhoto && req.files.startPhoto[0]) ||
      (req.file && req.file.fieldname === 'startPhoto' ? req.file : null);
    const endPhotoFile = (req.files && req.files.endPhoto && req.files.endPhoto[0]) ||
      (req.file && req.file.fieldname === 'endPhoto' ? req.file : null);
    const voiceFile = req.files && req.files.voice && req.files.voice[0];
    const hasVoice = Boolean(voiceFile);
    const slug = branchSlug(req);

    // ── CASE 1: Session already exists in DB ──────────────────────────────────
    const existing = await RecoverySession.findOne({ deviceSessionId });
    if (existing) {
      console.log(`[voice] file received: ${hasVoice ? 'yes' : 'no'}, ${hasVoice ? (voiceFile.size || 0) : 0} bytes, ${hasVoice ? (voiceFile.mimetype || 'none') : 'none'}`);
      if (existing.status === 'COMPLETED') {
        return res.status(200).json({ success: true, alreadySynced: true, session: existing });
      }

      const vehicleType = String(existing.vehicleType || '').toUpperCase();
      const needsPhoto = vehicleType === 'BIKE' || vehicleType === 'CAR';

      if (needsPhoto && !endPhotoFile && !existing.endSpeedometerEvidenceId) {
        return fail(res, 400, 'Ending speedometer photo is required to finish BIKE/CAR recovery.');
      }

      // ── customerMet block ─────────────────────────────────────────────────
      const cmBlock1 = parseCustomerMetBlock(body, hasVoice);
      if (cmBlock1.ok === false) return fail(res, cmBlock1.status, cmBlock1.message);

      const remarks = String(body.remarks || body.rawRemarks || existing.remarks || '').trim();
      if (cmBlock1.ok === null && !remarks) return fail(res, 400, 'Customer visit remarks are required.');

      // Voice upload BEFORE anything is persisted (Evidence, NLP, session fields, stats)
      let voiceResult1 = null;
      if (hasVoice) {
        voiceResult1 = await saveVoice(voiceFile, existing.sessionId, slug);
        if (!voiceResult1 || !voiceResult1.success) {
          return res.status(503).json({ success: false, message: 'Voice note could not be saved. Please try again.' });
        }
      }

      const endLoc = parseJson(body.endLocation, null);
      if (endPhotoFile) {
        const endEv = await saveImage({
          file: endPhotoFile,
          sessionId: existing.sessionId,
          branchSlug: slug,
          staffId,
          agentId,
          kind: 'END_SPEEDOMETER',
          location: endLoc,
          models: req.models
        });
        existing.endSpeedometerEvidenceId = endEv.evidenceId;
      }

      existing.endTime = body.endTime ? new Date(body.endTime) : new Date();
      existing.status = 'COMPLETED';

      if (cmBlock1.ok === true) {
        existing.customerMet = cmBlock1.customerMet;
        existing.customerNames = cmBlock1.customerNames;
        existing.metAt = cmBlock1.metAt;
        existing.notMetReason = cmBlock1.notMetReason;
      } else {
        let nlpSummary, nlpCategory, nlpDetails;
        try {
          ({ nlpSummary, nlpCategory, nlpDetails } = summarize(remarks));
        } catch (_e) {
          nlpSummary = ''; nlpCategory = 'GENERAL';
          nlpDetails = { names: [], amounts: [], dates: [], phones: [], keyPoints: [] };
        }
        existing.remarks = remarks;
        existing.rawRemarks = remarks;
        existing.visitNotes = remarks;
        existing.nlpSummary = nlpSummary;
        existing.nlpCategory = nlpCategory;
        existing.nlpDetails = nlpDetails;
      }

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

      if (voiceResult1 && voiceResult1.voicePath) {
        existing.voicePath = voiceResult1.voicePath;
        if (body.voiceDurationSeconds !== undefined) {
          existing.voiceDurationSeconds = Number(body.voiceDurationSeconds) || 0;
        }
      }

      const finalLoc = rules.pickLocation(endLoc);
      if (finalLoc) existing.endLocation = finalLoc;

      await existing.save();

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
    console.log(`[voice] file received: ${hasVoice ? 'yes' : 'no'}, ${hasVoice ? (voiceFile.size || 0) : 0} bytes, ${hasVoice ? (voiceFile.mimetype || 'none') : 'none'}`);

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

    // ── customerMet block ─────────────────────────────────────────────────
    const cmBlock2 = parseCustomerMetBlock(body, hasVoice);
    if (cmBlock2.ok === false) return fail(res, cmBlock2.status, cmBlock2.message);

    const remarks = String(body.remarks || body.rawRemarks || '').trim();
    if (cmBlock2.ok === null && !remarks) return fail(res, 400, 'Customer visit remarks are required.');

    const sessionId = (body.sessionId && String(body.sessionId).startsWith('SESS-'))
      ? String(body.sessionId)
      : `SESS-SYNC-${Date.now()}-${uuidv4().substring(0, 8)}`;

    const startLoc = parseJson(body.startLocation, null);
    const endLoc = parseJson(body.endLocation, null);

    // Voice upload BEFORE anything is persisted (Evidence, NLP, session creation, stats)
    let voiceResult2 = null;
    if (hasVoice) {
      voiceResult2 = await saveVoice(voiceFile, sessionId, slug);
      if (!voiceResult2 || !voiceResult2.success) {
        return res.status(503).json({ success: false, message: 'Voice note could not be saved. Please try again.' });
      }
    }

    let startEvidence = null;
    let endEvidence = null;

    if (startPhotoFile) {
      startEvidence = await saveImage({
        file: startPhotoFile,
        sessionId,
        branchSlug: slug,
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
        branchSlug: slug,
        staffId,
        agentId,
        kind: 'END_SPEEDOMETER',
        location: endLoc,
        models: req.models
      });
    }

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

    let createPayload;
    if (cmBlock2.ok === true) {
      createPayload = {
        customerMet: cmBlock2.customerMet,
        customerNames: cmBlock2.customerNames,
        metAt: cmBlock2.metAt,
        notMetReason: cmBlock2.notMetReason,
      };
    } else {
      let nlpSummary, nlpCategory, nlpDetails;
      try {
        ({ nlpSummary, nlpCategory, nlpDetails } = summarize(remarks));
      } catch (_e) {
        nlpSummary = ''; nlpCategory = 'GENERAL';
        nlpDetails = { names: [], amounts: [], dates: [], phones: [], keyPoints: [] };
      }
      createPayload = {
        remarks,
        rawRemarks: remarks,
        visitNotes: remarks,
        nlpSummary,
        nlpCategory,
        nlpDetails,
      };
    }

    if (voiceResult2 && voiceResult2.voicePath) {
      createPayload.voicePath = voiceResult2.voicePath;
      if (body.voiceDurationSeconds !== undefined) {
        createPayload.voiceDurationSeconds = Number(body.voiceDurationSeconds) || 0;
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
      startSpeedometerEvidenceId: startEvidence ? startEvidence.evidenceId : '',
      endSpeedometerEvidenceId: endEvidence ? endEvidence.evidenceId : '',
      startLocation: rules.pickLocation(startLoc),
      endLocation: rules.pickLocation(endLoc),
      area: body.area || '',
      ...createPayload,
    });

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

    if (assignmentId && assignmentId !== agentId) {
      await Assignment.updateOne(
        { _id: assignmentId, $or: [{ agentId }, { staffId }] },
        { recoveryStatus: 'FOLLOW_UP_REQUIRED', notes: remarks, lastVisitDate: session.endTime }
      ).catch(() => {});
    }

    await incrementAgentStats(agentId, session.distanceMeters, session, req.models);

    return res.status(201).json({ success: true, session });
  } catch (error) {
    console.error('syncOfflineSession error:', error.message);
    return fail(res, 500, errorMessage(error, 'Could not sync offline session.'));
  }
};

// GET /recovery/stats
exports.getAgentStats = async (req, res) => {
  const { RecoverySession, Assignment, Evidence, TrackingPoint, Staff } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

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

// GET /recovery/sessions/:sessionId/voice-url
exports.getVoiceUrl = async (req, res) => {
  const { RecoverySession } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();
    const { sessionId } = req.params;

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId }]
    }).lean();
    if (!session) return fail(res, 404, 'Session not found or access denied.');
    if (!session.voicePath) return fail(res, 404, 'No voice recording for this session.');

    const url = await storage.getSignedUrl(VOICE_BUCKET, session.voicePath, 300);
    return res.status(200).json({ success: true, url, expiresIn: 300 });
  } catch (error) {
    console.error('getVoiceUrl error:', error.message);
    return fail(res, 500, 'Could not generate voice URL.');
  }
};

// GET /recovery/evidence/:evidenceId/url
exports.getEvidenceUrl = async (req, res) => {
  const { Evidence } = req.models || {};
  try {
    if (!req.models && !getIsConnected()) return fail(res, 503, 'Database not connected.');
    const agentId = (req.agent && req.agent._id) || (req.staff && req.staff._id);
    const staffId = agentId.toString();

    const ev = await Evidence.findOne({ evidenceId: req.params.evidenceId }).lean();
    if (!ev) return fail(res, 404, 'Evidence not found.');

    const isOwner = ev.staffId.toString() === staffId || ev.agentId?.toString() === staffId;
    if (!isOwner) return fail(res, 403, 'Not allowed to access this evidence.');
    if (!ev.storagePath) return fail(res, 404, 'No cloud storage path for this evidence.');

    const url = await storage.getSignedUrl(PHOTO_BUCKET, ev.storagePath, 300);
    return res.status(200).json({ success: true, url, expiresIn: 300 });
  } catch (error) {
    console.error('getEvidenceUrl error:', error.message);
    return fail(res, 500, 'Could not generate evidence URL.');
  }
};



