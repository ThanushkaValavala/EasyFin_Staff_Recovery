require('dotenv').config();
const mongoose = require('mongoose');
const RecoverySession = require('../models/RecoverySession');
const Evidence = require('../models/Evidence');
const TrackingPoint = require('../models/TrackingPoint');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'easyfin_staff_recovery' });
  console.log('Database:', mongoose.connection.name);
  const s = await RecoverySession.findOne({}).sort({ createdAt: -1 });
  if (!s) { console.log('No recovery sessions saved yet.'); return; }

  const size = async (id) => {
    if (!id) return 'MISSING';
    const ev = await Evidence.findOne({ evidenceId: id }).select('+data');
    return ev && ev.data ? ev.data.length + ' bytes' : 'MISSING';
  };
  const points = await TrackingPoint.countDocuments({ sessionId: s.sessionId });

  console.log('Session      :', s.sessionId, '| status:', s.status);
  console.log('Staff id     :', String(s.staffId));
  console.log('Area         :', s.area || '(none)');
  console.log('Cases        :', (s.cases || []).length, '|', (s.cases || []).map((c) => String(c.assignmentId)).join(', '));
  console.log('Start / End  :', s.startTime, '/', s.endTime);
  console.log('Vehicle      :', s.vehicleType, s.vehicleNumber);
  console.log('Start photo  :', await size(s.startSpeedometerEvidenceId));
  console.log('End photo    :', await size(s.endSpeedometerEvidenceId));
  console.log('Remarks      :', s.remarks || '(none)');
  console.log('Start loc    :', JSON.stringify(s.startLocation), '| End loc:', JSON.stringify(s.endLocation));
  console.log('Track points :', points);
})().catch((e) => console.error('ERROR:', e.message)).finally(() => mongoose.disconnect());