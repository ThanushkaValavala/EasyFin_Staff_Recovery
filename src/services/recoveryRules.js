const RecoverySession = require('../models/RecoverySession');
const Evidence = require('../models/Evidence');
const memoryStore = require('./store');
const { getIsConnected } = require('../config/db');

const VEHICLE_TYPES = ['WALK', 'CYCLE', 'BIKE', 'SCOOTER', 'CAR', 'AUTO', 'OTHER'];

// Checks the vehicle type and number entered when a recovery starts.
const validateVehicle = (vehicleType, vehicleNumber) => {
  const type = String(vehicleType || '').trim().toUpperCase();
  const number = String(vehicleNumber || '').replace(/[\s-]/g, '').toUpperCase();

  // Walk and Cycle modes: no vehicle number required
  if (type === 'WALK' || type === 'CYCLE') {
    return { vehicleType: type, vehicleNumber: '' };
  }

  if (!VEHICLE_TYPES.includes(type)) {
    return {
      error: `Vehicle type is required. Choose one of: ${VEHICLE_TYPES.join(', ')}.`
    };
  }

  if (!/^[A-Z0-9]{4,12}$/.test(number)) {
    return { error: 'Enter a valid vehicle number (for example KA01AB1234).' };
  }

  return { vehicleType: type, vehicleNumber: number };
};

// Keeps only a clean { latitude, longitude } pair, or nothing.
const pickLocation = (loc) => {
  if (!loc) return undefined;

  const latitude = Number(loc.latitude);
  const longitude = Number(loc.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  return { latitude, longitude };
};

// Rules before a recovery can be completed:
//  1. at least one proof photo must be uploaded
//  2. if no money was collected, remarks are required
// Returns an error message, or null when everything is fine.
const validateCompletion = async ({ sessionId, staffId, paymentAmount, visitNotes }) => {
  let session;
  let evidenceCount;
  let hasSpeedometer = false;

  if (getIsConnected()) {
    session = await RecoverySession.findOne({ sessionId, staffId });
    evidenceCount = await Evidence.countDocuments({ sessionId, staffId });
    hasSpeedometer = (await Evidence.countDocuments({ sessionId, staffId, caption: /^Speedometer/i })) > 0;
  } else {
    await memoryStore.initDefaults();
    session = memoryStore.sessions.find(
      s => s.sessionId === sessionId && s.staffId === staffId
    );
    evidenceCount = memoryStore.evidences.filter(
      e => e.sessionId === sessionId && e.staffId === staffId
    ).length;
    hasSpeedometer = memoryStore.evidences.some(
      e => e.sessionId === sessionId && e.staffId === staffId && /^Speedometer/i.test(e.caption || '')
    );
  }

  // Unknown session: the controller will answer with its own 404.
  if (!session) return null;

  if (!hasSpeedometer) {
    return 'A speedometer photo must be uploaded when the recovery starts.';
  }

  if (evidenceCount < 1) {
    return 'A camera photo is required as proof before completing the recovery.';
  }

  const amount = Number(
    paymentAmount !== undefined ? paymentAmount : session.paymentAmount || 0
  );

  if (!Number.isFinite(amount) || amount < 0) {
    return 'Payment amount must be a valid number.';
  }

  const notes = String(
    visitNotes !== undefined ? visitNotes : session.visitNotes || ''
  ).trim();

  if (!notes) {
    return 'Remarks are required.';
  }

  return null;
};

module.exports = {
  VEHICLE_TYPES,
  validateVehicle,
  pickLocation,
  validateCompletion
};