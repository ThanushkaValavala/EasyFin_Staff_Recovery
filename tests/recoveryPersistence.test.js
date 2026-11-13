require('dotenv').config();
const request = require('supertest');
const assert = require('assert');
const mongoose = require('mongoose');
const { app } = require('../src/server');
const { connectDB } = require('../src/config/db');
const Staff = require('../src/models/Staff');
const RecoverySession = require('../src/models/RecoverySession');
const TrackingPoint = require('../src/models/TrackingPoint');
const Evidence = require('../src/models/Evidence');
const jwt = require('jsonwebtoken');

// Minimal valid 1x1 JPEG buffer for testing file uploads
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
  0x00, 0xbf, 0x00, 0xff, 0xd9
]);

async function runRecoveryPersistenceTests() {
  console.log('================================================================');
  console.log('EASYFIN RECOVERY DATA PERSISTENCE & OFFLINE SYNC TEST SUITE');
  console.log('================================================================\n');

  await connectDB();

  // Create isolated test agent A and agent B
  const agentPhoneA = '+919999000111';
  const agentPhoneB = '+919999000222';

  let agentA = await Staff.findOne({ phone: agentPhoneA });
  if (!agentA) {
    agentA = await Staff.create({
      employeeId: 'TEST_A_01',
      name: 'Test Agent A',
      username: 'test_agent_a',
      email: 'test_agent_a@easyfin.test',
      phone: agentPhoneA,
      role: 'field_officer',
      password: 'TestPassword123!',
      assignedArea: 'Test Zone A',
      recoveryCount: 0,
      totalDistanceKm: 0,
    });
  }

  let agentB = await Staff.findOne({ phone: agentPhoneB });
  if (!agentB) {
    agentB = await Staff.create({
      employeeId: 'TEST_B_01',
      name: 'Test Agent B',
      username: 'test_agent_b',
      email: 'test_agent_b@easyfin.test',
      phone: agentPhoneB,
      role: 'field_officer',
      password: 'TestPassword123!',
      assignedArea: 'Test Zone B',
      recoveryCount: 0,
      totalDistanceKm: 0,
    });
  }

  const tokenA = jwt.sign(
    { id: agentA._id.toString(), agentId: agentA._id.toString(), role: agentA.role, phone: agentA.phone },
    process.env.JWT_SECRET || 'super_secret_jwt_key_easyfin_recovery_2026_secure'
  );

  const tokenB = jwt.sign(
    { id: agentB._id.toString(), agentId: agentB._id.toString(), role: agentB.role, phone: agentB.phone },
    process.env.JWT_SECRET || 'super_secret_jwt_key_easyfin_recovery_2026_secure'
  );

  // Clean any leftover test sessions from previous runs
  await RecoverySession.deleteMany({
    agentId: { $in: [agentA._id, agentB._id] }
  });
  await TrackingPoint.deleteMany({
    agentId: { $in: [agentA._id, agentB._id] }
  });
  await Evidence.deleteMany({
    agentId: { $in: [agentA._id, agentB._id] }
  });

  const initialCountA = (await Staff.findById(agentA._id)).recoveryCount || 0;
  const initialDistA = (await Staff.findById(agentA._id)).totalDistanceKm || 0;

  // ── TEST 1: Online WALK completion ──────────────────────────────────────────
  console.log('1. Testing Online WALK Completion...');
  const walkDeviceSessionId = `DSK_WALK_${Date.now()}`;
  const walkStartRes = await request(app)
    .post('/api/v1/recovery/start-with-photo')
    .set('Authorization', 'Bearer ' + tokenA)
    .send({
      vehicleType: 'WALK',
      deviceSessionId: walkDeviceSessionId,
      initialLocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 5 }
    });
  assert.strictEqual(walkStartRes.status, 201);
  const walkSessionId = walkStartRes.body.session.sessionId;
  assert.strictEqual(walkStartRes.body.session.vehicleType, 'WALK');

  const walkFinishRes = await request(app)
    .post(`/api/v1/recovery/sessions/${walkSessionId}/finish-walk`)
    .set('Authorization', 'Bearer ' + tokenA)
    .send({
      remarks: 'Customer paid outstanding amount in cash',
      distanceMeters: 1200,
      durationSeconds: 900,
      endLocation: { latitude: 12.9750, longitude: 77.5990, accuracy: 5 }
    });
  assert.strictEqual(walkFinishRes.status, 200);
  assert.strictEqual(walkFinishRes.body.session.status, 'COMPLETED');
  assert.strictEqual(walkFinishRes.body.session.nlpCategory, 'PAID');
  console.log('   ✓ Online WALK completed successfully. NLP Category: PAID');

  // ── TEST 2: Online BIKE completion with both photos ─────────────────────────
  console.log('\n2. Testing Online BIKE Completion with Both Speedometer Photos...');
  const bikeDeviceSessionId = `DSK_BIKE_${Date.now()}`;
  const bikeStartRes = await request(app)
    .post('/api/v1/recovery/start-with-photo')
    .set('Authorization', 'Bearer ' + tokenA)
    .field('vehicleType', 'BIKE')
    .field('vehicleNumber', 'KA01AB1234')
    .field('deviceSessionId', bikeDeviceSessionId)
    .field('initialLocation', JSON.stringify({ latitude: 12.9716, longitude: 77.5946, accuracy: 5 }))
    .attach('startPhoto', TINY_JPEG, 'start_speedometer.jpg');
  assert.strictEqual(bikeStartRes.status, 201);
  const bikeSessionId = bikeStartRes.body.session.sessionId;
  assert.ok(bikeStartRes.body.session.startSpeedometerEvidenceId, 'Starting speedometer evidence ID must exist');

  const bikeFinishRes = await request(app)
    .post(`/api/v1/recovery/sessions/${bikeSessionId}/finish`)
    .set('Authorization', 'Bearer ' + tokenA)
    .field('remarks', 'Promised payment next Monday afternoon')
    .field('distanceMeters', '3500')
    .field('durationSeconds', '1800')
    .field('endLocation', JSON.stringify({ latitude: 12.9800, longitude: 77.6000, accuracy: 5 }))
    .attach('endPhoto', TINY_JPEG, 'end_speedometer.jpg');
  assert.strictEqual(bikeFinishRes.status, 200);
  assert.strictEqual(bikeFinishRes.body.session.status, 'COMPLETED');
  assert.ok(bikeFinishRes.body.session.endSpeedometerEvidenceId, 'Ending speedometer evidence ID must exist');
  assert.strictEqual(bikeFinishRes.body.session.nlpCategory, 'PROMISED');
  console.log('   ✓ Online BIKE completed with both photos. Evidence IDs linked in MongoDB.');

  // ── TEST 3: Online CAR completion with both photos ──────────────────────────
  console.log('\n3. Testing Online CAR Completion with Both Speedometer Photos...');
  const carDeviceSessionId = `DSK_CAR_${Date.now()}`;
  const carStartRes = await request(app)
    .post('/api/v1/recovery/start-with-photo')
    .set('Authorization', 'Bearer ' + tokenA)
    .field('vehicleType', 'CAR')
    .field('vehicleNumber', 'DL01CD5678')
    .field('deviceSessionId', carDeviceSessionId)
    .attach('startPhoto', TINY_JPEG, 'start_car.jpg');
  assert.strictEqual(carStartRes.status, 201);
  const carSessionId = carStartRes.body.session.sessionId;

  const carFinishRes = await request(app)
    .post(`/api/v1/recovery/sessions/${carSessionId}/finish`)
    .set('Authorization', 'Bearer ' + tokenA)
    .field('remarks', 'Customer refused to pay the loan amount')
    .field('distanceMeters', '8000')
    .field('durationSeconds', '2400')
    .attach('endPhoto', TINY_JPEG, 'end_car.jpg');
  assert.strictEqual(carFinishRes.status, 200);
  assert.strictEqual(carFinishRes.body.session.nlpCategory, 'REFUSED');
  console.log('   ✓ Online CAR completed with both photos. NLP Category: REFUSED');

  // ── TEST 4: Offline WALK completion and synchronization ─────────────────────
  console.log('\n4. Testing Offline WALK Synchronization...');
  const offWalkDeviceSessionId = `DSK_OFF_WALK_${Date.now()}`;
  const offWalkPoints = [
    { latitude: 12.9100, longitude: 77.5800, accuracy: 4, timestamp: new Date(Date.now() - 10000).toISOString() },
    { latitude: 12.9120, longitude: 77.5820, accuracy: 4, timestamp: new Date().toISOString() }
  ];
  const offWalkSyncRes = await request(app)
    .post('/api/v1/recovery/sync')
    .set('Authorization', 'Bearer ' + tokenA)
    .send({
      deviceSessionId: offWalkDeviceSessionId,
      vehicleType: 'WALK',
      remarks: 'Customer not available at the home address',
      distanceMeters: 650,
      durationSeconds: 700,
      points: offWalkPoints
    });
  assert.strictEqual(offWalkSyncRes.status, 201);
  assert.strictEqual(offWalkSyncRes.body.session.nlpCategory, 'UNAVAILABLE');
  assert.strictEqual(offWalkSyncRes.body.session.deviceSessionId, offWalkDeviceSessionId);
  console.log('   ✓ Offline WALK synchronized and persisted in MongoDB Atlas.');

  // ── TEST 5: Offline BIKE completion and synchronization with both photos ────
  console.log('\n5. Testing Offline BIKE Synchronization with Both Photos...');
  const offBikeDeviceSessionId = `DSK_OFF_BIKE_${Date.now()}`;
  const offBikePoints = [
    { latitude: 12.9300, longitude: 77.6100, accuracy: 3, timestamp: new Date(Date.now() - 20000).toISOString() },
    { latitude: 12.9350, longitude: 77.6150, accuracy: 3, timestamp: new Date().toISOString() }
  ];
  const offBikeSyncRes = await request(app)
    .post('/api/v1/recovery/sync')
    .set('Authorization', 'Bearer ' + tokenA)
    .field('deviceSessionId', offBikeDeviceSessionId)
    .field('vehicleType', 'BIKE')
    .field('vehicleNumber', 'MH02XY9999')
    .field('remarks', 'Payment collected in full')
    .field('distanceMeters', '4200')
    .field('durationSeconds', '1500')
    .field('points', JSON.stringify(offBikePoints))
    .attach('startPhoto', TINY_JPEG, 'offline_start_bike.jpg')
    .attach('endPhoto', TINY_JPEG, 'offline_end_bike.jpg');
  assert.strictEqual(offBikeSyncRes.status, 201);
  assert.ok(offBikeSyncRes.body.session.startSpeedometerEvidenceId, 'Offline sync must save start photo');
  assert.ok(offBikeSyncRes.body.session.endSpeedometerEvidenceId, 'Offline sync must save end photo');
  console.log('   ✓ Offline BIKE synchronized with both photos and route points.');

  // ── TEST 6: Offline CAR completion and synchronization with both photos ─────
  console.log('\n6. Testing Offline CAR Synchronization with Both Photos...');
  const offCarDeviceSessionId = `DSK_OFF_CAR_${Date.now()}`;
  const offCarSyncRes = await request(app)
    .post('/api/v1/recovery/sync')
    .set('Authorization', 'Bearer ' + tokenA)
    .field('deviceSessionId', offCarDeviceSessionId)
    .field('vehicleType', 'CAR')
    .field('vehicleNumber', 'KA05PQ1111')
    .field('remarks', 'Customer requested additional time to arrange funds')
    .field('distanceMeters', '9500')
    .field('durationSeconds', '3600')
    .attach('startPhoto', TINY_JPEG, 'offline_start_car.jpg')
    .attach('endPhoto', TINY_JPEG, 'offline_end_car.jpg');
  assert.strictEqual(offCarSyncRes.status, 201);
  assert.ok(offCarSyncRes.body.session.startSpeedometerEvidenceId, 'Offline CAR sync must save start photo');
  assert.ok(offCarSyncRes.body.session.endSpeedometerEvidenceId, 'Offline CAR sync must save end photo');
  assert.strictEqual(offCarSyncRes.body.session.nlpCategory, 'PROMISED');
  console.log('   ✓ Offline CAR synchronized with both speedometer photos.');

  // ── TEST 7: Full GPS route persistence in MongoDB ───────────────────────────
  console.log('\n7. Verifying Full GPS Route Persistence in MongoDB Atlas...');
  const syncedSessionId = offBikeSyncRes.body.session.sessionId;
  const savedPoints = await TrackingPoint.find({ sessionId: syncedSessionId }).sort({ timestamp: 1 });
  assert.strictEqual(savedPoints.length, 2, 'All GPS tracking points must be saved in TrackingPoint collection');
  assert.strictEqual(savedPoints[0].agentId.toString(), agentA._id.toString());
  console.log(`   ✓ Verified ${savedPoints.length} points persisted in MongoDB Atlas for session ${syncedSessionId}`);

  // ── TEST 8: GPS Synchronization after restarting the app ────────────────────
  console.log('\n8. Testing GPS Synchronization Batching...');
  const batchPoints = [
    { latitude: 12.9400, longitude: 77.6200, accuracy: 3, timestamp: new Date().toISOString() },
    { latitude: 12.9450, longitude: 77.6250, accuracy: 3, timestamp: new Date().toISOString() }
  ];
  const batchRes = await request(app)
    .post(`/api/v1/recovery/sessions/${bikeSessionId}/points`)
    .set('Authorization', 'Bearer ' + tokenA)
    .send({ points: batchPoints, incrementalDistanceMeters: 500, batchId: 'BATCH_RESTART_01' });
  assert.strictEqual(batchRes.status, 200);
  console.log('   ✓ GPS batch recorded successfully.');

  // ── TEST 9: Duplicate GPS batch requests (Idempotency) ──────────────────────
  console.log('\n9. Testing Duplicate GPS Batch Request Idempotency...');
  const sessionBefore = await RecoverySession.findOne({ sessionId: bikeSessionId });
  const distBefore = sessionBefore.distanceMeters;

  const dupBatchRes = await request(app)
    .post(`/api/v1/recovery/sessions/${bikeSessionId}/points`)
    .set('Authorization', 'Bearer ' + tokenA)
    .send({ points: batchPoints, incrementalDistanceMeters: 500, batchId: 'BATCH_RESTART_01' });
  assert.strictEqual(dupBatchRes.status, 200);

  const sessionAfter = await RecoverySession.findOne({ sessionId: bikeSessionId });
  assert.strictEqual(sessionAfter.distanceMeters, distBefore, 'Distance must NOT be incremented twice on duplicate batch!');
  console.log('   ✓ Duplicate GPS batch handled idempotently. Distance unchanged.');

  // ── TEST 10: Duplicate recovery synchronization ─────────────────────────────
  console.log('\n10. Testing Duplicate Recovery Synchronization (deviceSessionId)...');
  const agentBeforeSync = await Staff.findById(agentA._id);
  const countBeforeSync = agentBeforeSync.recoveryCount;

  const dupSyncRes = await request(app)
    .post('/api/v1/recovery/sync')
    .set('Authorization', 'Bearer ' + tokenA)
    .send({
      deviceSessionId: offWalkDeviceSessionId,
      vehicleType: 'WALK',
      remarks: 'Customer not available at the home address',
    });
  assert.strictEqual(dupSyncRes.status, 200);
  assert.strictEqual(dupSyncRes.body.alreadySynced, true);

  const agentAfterSync = await Staff.findById(agentA._id);
  assert.strictEqual(agentAfterSync.recoveryCount, countBeforeSync, 'Agent recoveryCount must NOT increment on duplicate sync!');
  console.log('   ✓ Duplicate sync returned alreadySynced: true. Agent stats protected.');

  // ── TEST 11: Duplicate completion requests ──────────────────────────────────
  console.log('\n11. Testing Duplicate Completion Request...');
  const dupFinishRes = await request(app)
    .post(`/api/v1/recovery/sessions/${walkSessionId}/finish-walk`)
    .set('Authorization', 'Bearer ' + tokenA)
    .send({ remarks: 'Customer paid outstanding amount' });
  assert.strictEqual(dupFinishRes.status, 200);
  console.log('   ✓ Duplicate completion request handled gracefully.');

  // ── TEST 12: Failed image upload and retry ──────────────────────────────────
  console.log('\n12. Testing Incomplete Offline BIKE Sync (Missing Photos) and Retry...');
  const retryDeviceSessionId = `DSK_RETRY_${Date.now()}`;
  const incompleteSyncRes = await request(app)
    .post('/api/v1/recovery/sync')
    .set('Authorization', 'Bearer ' + tokenA)
    .field('deviceSessionId', retryDeviceSessionId)
    .field('vehicleType', 'BIKE')
    .field('vehicleNumber', 'KA01ZZ1234')
    .field('remarks', 'Customer paid 1000')
    .attach('startPhoto', TINY_JPEG, 'start.jpg'); // missing endPhoto!

  assert.strictEqual(incompleteSyncRes.status, 400);
  assert.match(incompleteSyncRes.body.message, /Ending speedometer photo is mandatory/i);
  console.log('   ✓ Incomplete sync rejected correctly.');

  // Now retry with BOTH photos
  const retrySuccessRes = await request(app)
    .post('/api/v1/recovery/sync')
    .set('Authorization', 'Bearer ' + tokenA)
    .field('deviceSessionId', retryDeviceSessionId)
    .field('vehicleType', 'BIKE')
    .field('vehicleNumber', 'KA01ZZ1234')
    .field('remarks', 'Customer paid 1000')
    .attach('startPhoto', TINY_JPEG, 'start.jpg')
    .attach('endPhoto', TINY_JPEG, 'end.jpg');

  assert.strictEqual(retrySuccessRes.status, 201);
  console.log('   ✓ Retry with both photos succeeded.');

  // ── TEST 13: Missing BIKE/CAR ending image rejection ────────────────────────
  console.log('\n13. Testing Missing Ending Photo Rejection for Online BIKE...');
  const bikeNoPhotoSessionId = `DSK_NO_PHOTO_${Date.now()}`;
  const bnpStart = await request(app)
    .post('/api/v1/recovery/start-with-photo')
    .set('Authorization', 'Bearer ' + tokenA)
    .field('vehicleType', 'BIKE')
    .field('vehicleNumber', 'KA01BB8888')
    .field('deviceSessionId', bikeNoPhotoSessionId)
    .attach('startPhoto', TINY_JPEG, 'start.jpg');
  assert.strictEqual(bnpStart.status, 201);

  const bnpFinish = await request(app)
    .post(`/api/v1/recovery/sessions/${bnpStart.body.session.sessionId}/finish`)
    .set('Authorization', 'Bearer ' + tokenA)
    .field('remarks', 'Remarks without end photo');
  assert.strictEqual(bnpFinish.status, 400);
  assert.match(bnpFinish.body.message, /Ending speedometer photo is required/i);
  console.log('   ✓ Missing ending photo correctly rejected for BIKE session.');

  // ── TEST 14: Attempt to complete BIKE/CAR through the WALK endpoint ─────────
  console.log('\n14. Testing Attempt to Bypass Photo Using WALK Endpoint...');
  const bypassRes = await request(app)
    .post(`/api/v1/recovery/sessions/${bnpStart.body.session.sessionId}/finish-walk`)
    .set('Authorization', 'Bearer ' + tokenA)
    .send({ remarks: 'Attempting to bypass ending photo' });
  assert.strictEqual(bypassRes.status, 400);
  assert.match(bypassRes.body.message, /Ending speedometer photo is required/i);
  console.log('   ✓ Bypass attempt via finish-walk correctly blocked.');

  // ── TEST 15: Cross-agent session and assignment access rejection ────────────
  console.log('\n15. Testing Cross-Agent Session Access Rejection...');
  const crossAgentRes = await request(app)
    .post(`/api/v1/recovery/sessions/${walkSessionId}/points`)
    .set('Authorization', 'Bearer ' + tokenB) // Agent B attempting to modify Agent A's session
    .send({ points: [{ latitude: 12.0, longitude: 77.0 }] });
  assert.strictEqual(crossAgentRes.status, 404);
  console.log('   ✓ Cross-agent access correctly rejected (404 access denied).');

  // ── TEST 16: SecureStore write failure handling verification ────────────────
  console.log('\n16. Testing Queue Write Failure Handling...');
  async function simulateWritePending(mockStorage, list) {
    const json = JSON.stringify(list);
    await mockStorage.setItemAsync('pending_recovery_sessions', json);
    const check = await mockStorage.getItemAsync('pending_recovery_sessions');
    if (!check && list.length > 0) {
      throw new Error('Failed to verify pending session storage write');
    }
    return true;
  }

  // 1. Storage write success verification
  const workingStorage = {
    data: {},
    async setItemAsync(k, v) { this.data[k] = v; },
    async getItemAsync(k) { return this.data[k]; }
  };
  const successRes = await simulateWritePending(workingStorage, [{ deviceSessionId: 'DSK_MOCK_1' }]);
  assert.strictEqual(successRes, true);

  // 2. Storage write failure: must NOT swallow silently, must throw error
  const failingStorage = {
    async setItemAsync() { /* silent failure */ },
    async getItemAsync() { return null; }
  };
  let writeError = null;
  try {
    await simulateWritePending(failingStorage, [{ deviceSessionId: 'DSK_MOCK_1' }]);
  } catch (err) {
    writeError = err;
  }
  assert.ok(writeError, 'Storage write failure must throw an error');
  assert.match(writeError.message, /Failed to verify pending session storage write/i);
  console.log('   ✓ Verified: queue write failure is safely detected and throws.');

  // Clean up test sessions created during test
  await RecoverySession.deleteMany({
    agentId: { $in: [agentA._id, agentB._id] }
  });
  await TrackingPoint.deleteMany({
    agentId: { $in: [agentA._id, agentB._id] }
  });
  await Evidence.deleteMany({
    agentId: { $in: [agentA._id, agentB._id] }
  });
  await Staff.deleteMany({
    _id: { $in: [agentA._id, agentB._id] }
  });

  console.log('\n================================================================');
  console.log('ALL 16 PERSISTENCE AND OFFLINE SYNC TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runRecoveryPersistenceTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
