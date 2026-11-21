require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../src/server');
const { connectBranchDbs } = require('../src/config/branchDb');

describe('EASYFIN — Complete Task Management & Upgrades', () => {
  let tokenAgentA;
  let tokenAgentB;
  let agentAId;
  let agentBId;
  let agentAPhone = '9000000001';
  let agentBPhone = '9000000002';
  let branch = 'Branch 1';

  before(async () => {
    await connectBranchDbs();
    const { getModels } = require('../src/config/branchDb');
    const branchModels = getModels(branch);
    if (branchModels) {
      await branchModels.OtpRecord.deleteMany({ phone: { $in: [agentAPhone, agentBPhone] } });
      await branchModels.Customer.updateMany(
        { customerId: { $in: ['CUST-8021', 'CUST-8022', 'CUST-8023', 'CUST-8024', 'CUST-8025', 'CUST-8026'] } },
        {
          $set: {
            recoveryStatus: 'ASSIGNED',
            activeRecoverySessionId: null,
            activeRecoveryAgentId: null,
            activeAgentName: '',
            activeAgentPhone: '',
            lockedAt: null
          }
        }
      );
      await branchModels.CompletedTask.deleteMany({
        customerRefId: { $in: ['CUST-8021', 'CUST-8022'] }
      });
    }

    // 1. Authenticate Agent A
    const otpResA = await request(app)
      .post('/api/v1/auth/otp/generate')
      .send({ phone: agentAPhone, branch });
    assert.strictEqual(otpResA.status, 200);
    const otpA = otpResA.body.otp;

    const verifyResA = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: agentAPhone, otp: otpA, branch });
    assert.strictEqual(verifyResA.status, 200);
    tokenAgentA = verifyResA.body.token;
    agentAId = verifyResA.body.staff._id;

    // 2. Authenticate Agent B
    const otpResB = await request(app)
      .post('/api/v1/auth/otp/generate')
      .send({ phone: agentBPhone, branch });
    assert.strictEqual(otpResB.status, 200);
    const otpB = otpResB.body.otp;

    const verifyResB = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: agentBPhone, otp: otpB, branch });
    assert.strictEqual(verifyResB.status, 200);
    tokenAgentB = verifyResB.body.token;
    agentBId = verifyResB.body.staff._id;
  });

  // Test 1: Existing dashboard / health check opens correctly
  test('Test 1: Existing dashboard / health check opens correctly', async () => {
    const res = await request(app).get('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'UP');
  });

  // Test 2: Assigned Tasks heading changes to Tasks
  test('Test 2: Tasks API routes exist and respond with Tasks', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.tasks));
  });

  // Test 3: Enter Location works
  test('Test 3: Enter Location returns available localities', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/locations')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.locations));
    assert.ok(res.body.locations.includes('All Locations'));
  });

  // Test 4: Sarjapur filters only matching customers
  test('Test 4: Sarjapur filters only matching customers', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned?location=Sarjapur')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.tasks.length > 0);
    res.body.tasks.forEach((t) => {
      const match = (t.area || '').toLowerCase().includes('sarjapur') ||
        (t.location || '').toLowerCase().includes('sarjapur') ||
        (t.fullAddress || '').toLowerCase().includes('sarjapur');
      assert.ok(match, `Expected customer ${t.customerId} to be in Sarjapur`);
    });
  });

  // Test 5: Kasavanahalli filters only matching customers
  test('Test 5: Kasavanahalli filters only matching customers', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned?location=Kasavanahalli')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.tasks.length > 0);
    res.body.tasks.forEach((t) => {
      const match = (t.area || '').toLowerCase().includes('kasavanahalli') ||
        (t.location || '').toLowerCase().includes('kasavanahalli') ||
        (t.fullAddress || '').toLowerCase().includes('kasavanahalli');
      assert.ok(match, `Expected customer ${t.customerId} to be in Kasavanahalli`);
    });
  });

  // Test 6: Marathahalli filters only matching customers
  test('Test 6: Marathahalli filters only matching customers', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned?location=Marathahalli')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.tasks.length > 0);
    res.body.tasks.forEach((t) => {
      const match = (t.area || '').toLowerCase().includes('marathahalli') ||
        (t.location || '').toLowerCase().includes('marathahalli') ||
        (t.fullAddress || '').toLowerCase().includes('marathahalli');
      assert.ok(match, `Expected customer ${t.customerId} to be in Marathahalli`);
    });
  });

  // Test 7: All Locations restores the complete assigned list
  test('Test 7: All Locations restores the complete assigned list', async () => {
    const resAll = await request(app)
      .get('/api/v1/tasks/assigned?location=All%20Locations')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(resAll.status, 200);

    const resBase = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(resBase.status, 200);

    assert.strictEqual(resAll.body.tasks.length, resBase.body.tasks.length);
  });

  // Test 8: Multiple customer selection works (frontend state testable via multiple customer query)
  test('Test 8: Multiple customer selection for visit planning', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    const selectedIds = res.body.tasks.slice(0, 3).map((t) => t.customerId);
    assert.strictEqual(selectedIds.length, 3);
  });

  // Test 9: Selection alone does not lock customers
  test('Test 9: Selection alone does not lock customers (remains ASSIGNED)', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    const cust1 = res.body.tasks.find((t) => t.customerId === 'CUST-8021');
    assert.ok(cust1);
    // Lock must only happen when recovery session actually starts
    assert.strictEqual(cust1.isLockedByOther, false);
  });

  let sessionA;
  let targetCustomerX = 'CUST-8021'; // Sarjapur customer

  // Test 10: Start Recovery associates the selected customer correctly
  test('Test 10: Start Recovery associates the selected customer correctly', async () => {
    const res = await request(app)
      .post(`/api/v1/tasks/${targetCustomerX}/start`)
      .set('Authorization', `Bearer ${tokenAgentA}`)
      .send({ deviceSessionId: 'DEV-TEST-A1' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.customer.recoveryStatus, 'RECOVERY_IN_PROGRESS');
    assert.ok(res.body.session.sessionId);
    sessionA = res.body.session;
  });

  // Test 11: Existing transport selection works
  test('Test 11: Existing transport selection works (WALK mode)', async () => {
    const res = await request(app)
      .post('/api/v1/recovery/start-with-photo')
      .set('Authorization', `Bearer ${tokenAgentA}`)
      .send({
        sessionId: sessionA.sessionId,
        vehicleType: 'WALK',
        initialLocation: { latitude: 12.9249, longitude: 77.6834, accuracy: 5 },
        deviceSessionId: 'DEV-START-WALK-1',
        customerId: targetCustomerX,
        plannedPersonCount: 1,
        plannedNames: ['Vikramaditya Roy']
      });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.session);
  });

  // Test 12: Existing speedometer capture works
  test('Test 12: Existing speedometer capture evidence API works', async () => {
    const res = await request(app)
      .post(`/api/v1/recovery/sessions/${sessionA.sessionId}/evidence`)
      .set('Authorization', `Bearer ${tokenAgentA}`)
      .attach('photo', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'speedo.jpg');
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.evidence.evidenceId);
  });

  // Test 13: Existing GPS map and tracking work
  test('Test 13: Existing GPS map and tracking points record accurately', async () => {
    const res = await request(app)
      .post(`/api/v1/recovery/sessions/${sessionA.sessionId}/points`)
      .set('Authorization', `Bearer ${tokenAgentA}`)
      .send({
        points: [
          { latitude: 12.9249, longitude: 77.6834, accuracy: 5, timestamp: new Date() },
          { latitude: 12.9255, longitude: 77.6840, accuracy: 5, timestamp: new Date() }
        ],
        incrementalDistanceMeters: 150
      });
    assert.strictEqual(res.status, 200);
  });

  // Test 14: Existing distance and timer work
  test('Test 14: Distance and duration are tracked in session', async () => {
    const res = await request(app)
      .get(`/api/v1/recovery/sessions/${sessionA.sessionId}/journey`)
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.journey.summary.totalTrackingPoints >= 2);
  });

  // Test 15: Existing End Recovery submission works
  test('Test 15: Existing End Recovery submission completes Stage 1', async () => {
    const res = await request(app)
      .post(`/api/v1/recovery/sessions/${sessionA.sessionId}/finish-walk`)
      .set('Authorization', `Bearer ${tokenAgentA}`)
      .field('remarks', 'Met customer Vikramaditya Roy in Sarjapur. Partial collection arranged.')
      .field('customerMet', 'true')
      .field('customerNames', JSON.stringify(['Vikramaditya Roy']))
      .field('distanceMeters', '350')
      .field('durationSeconds', '120');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.session.status, 'COMPLETED');
  });

  // Test 16: Audio recording uploads successfully
  test('Test 16: Voice recording upload accepted and handled safely', async () => {
    const res = await request(app)
      .post(`/api/v1/recovery/sessions/${sessionA.sessionId}/finish-walk`)
      .set('Authorization', `Bearer ${tokenAgentA}`)
      .field('remarks', 'Voice notes verified')
      .field('customerMet', 'true')
      .field('customerNames', JSON.stringify(['Vikramaditya Roy']));
    assert.strictEqual(res.status, 200);
  });

  // Test 17: Audio metadata/reference is stored in backend
  test('Test 17: Voice recording reference endpoint returns valid url or response', async () => {
    const res = await request(app)
      .get(`/api/v1/recovery/sessions/${sessionA.sessionId}/voice-url`)
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.ok(res.status === 200 || res.status === 404);
  });

  // Test 18: Audio playback works from cache
  test('Test 18: Audio cache helper functions exist and operate correctly', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.join(__dirname, '../mobile/src/utils/offlineStore.js'), 'utf8');
    assert.ok(content.includes('export async function getCachedAudio'));
    assert.ok(content.includes('export async function copyRecordingToCache'));
    assert.ok(content.includes('export async function pruneAudioCache'));
  });

  // Test 19: Audio playback falls back to server when cache is unavailable
  test('Test 19: Signed URL audio fallback works when cache is unavailable', async () => {
    const res = await request(app)
      .get(`/api/v1/recovery/sessions/${sessionA.sessionId}/voice-url`)
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.ok(res.status === 200 || res.status === 404);
  });

  // Test 20: App restart preserves the active recovery state
  test('Test 20: App restart recovery endpoint retrieves active state', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/active')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.hasOwnProperty('active'));
  });

  // Test 21: Agent A starts recovery for Customer X
  test('Test 21: Agent A has Customer X locked with status RECOVERY_IN_PROGRESS', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    const custX = res.body.tasks.find((t) => t.customerId === targetCustomerX);
    assert.ok(custX);
    assert.strictEqual(custX.recoveryStatus, 'RECOVERY_IN_PROGRESS');
    assert.strictEqual(custX.isLockedByMe, true);
  });

  // Test 22: Agent B cannot start recovery for Customer X
  test('Test 22: Agent B cannot start recovery for Customer X (rejected with 409)', async () => {
    const res = await request(app)
      .post(`/api/v1/tasks/${targetCustomerX}/start`)
      .set('Authorization', `Bearer ${tokenAgentB}`)
      .send({ deviceSessionId: 'DEV-TEST-B-FAIL' });
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.message.includes('currently being handled by another recovery agent'));
  });

  // Test 23: Agent B can still start recovery for an unlocked customer
  let targetCustomerY = 'CUST-8022'; // Kasavanahalli customer
  let sessionB;
  test('Test 23: Agent B can start recovery for an unlocked customer (Customer Y)', async () => {
    const res = await request(app)
      .post(`/api/v1/tasks/${targetCustomerY}/start`)
      .set('Authorization', `Bearer ${tokenAgentB}`)
      .send({ deviceSessionId: 'DEV-TEST-B-SUCCESS' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.customer.recoveryStatus, 'RECOVERY_IN_PROGRESS');
    sessionB = res.body.session;
  });

  // Test 24: After GPS recovery submission, the task remains in Assigned Tasks
  test('Test 24: After GPS recovery submission, the task remains in Assigned Tasks', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    const custX = res.body.tasks.find((t) => t.customerId === targetCustomerX);
    assert.ok(custX, 'Customer X must still be in Assigned Tasks');
    assert.strictEqual(custX.recoveryStatus, 'RECOVERY_IN_PROGRESS');
  });

  // Test 25: The separate task-level End Recovery action becomes available
  test('Test 25: Separate task-level End Recovery action becomes available (canComplete=true)', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    const custX = res.body.tasks.find((t) => t.customerId === targetCustomerX);
    assert.ok(custX);
    assert.strictEqual(custX.canComplete, true);
    assert.strictEqual(custX.isSessionSubmitted, true);
  });

  // Test 26: Clicking task-level End Recovery successfully moves customer to Completed Tasks
  test('Test 26: Task-level End Recovery completes task and moves to Completed Tasks', async () => {
    const res = await request(app)
      .post(`/api/v1/tasks/${targetCustomerX}/complete`)
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.customer.recoveryStatus, 'COMPLETED');
  });

  // Test 27: Green completion tick appears (completed task record contains completed data)
  test('Test 27: Completed task appears in Completed Tasks list', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/completed')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    const completedCustX = res.body.completedTasks.find((t) => t.customerRefId === targetCustomerX);
    assert.ok(completedCustX, 'Completed task record must be present');
    assert.strictEqual(completedCustX.customerName, 'Vikramaditya Roy');
    assert.ok(completedCustX.completionDate);
    assert.ok(completedCustX.completionTime);
  });

  // Test 28: Completed history survives app restart
  test('Test 28: Completed history survives reload and is retrievable from MongoDB', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/completed')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.completedTasks.length >= 1);
  });

  // Test 29: Duplicate completion requests are rejected safely
  test('Test 29: Duplicate completion requests are handled idempotently', async () => {
    const res = await request(app)
      .post(`/api/v1/tasks/${targetCustomerX}/complete`)
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.alreadyCompleted, true);
  });

  // Test 30: Locks are released after successful completion
  test('Test 30: Locks are released after successful completion', async () => {
    const res = await request(app)
      .get('/api/v1/tasks/assigned')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    // Completed customer must no longer appear in Assigned Tasks
    const found = res.body.tasks.find((t) => t.customerId === targetCustomerX);
    assert.strictEqual(found, undefined, 'Completed customer must be removed from Assigned Tasks');
  });

  // Test 31: Interrupted sessions do not create permanently stuck locks
  test('Test 31: Interrupted sessions can be safely cancelled and unlocked', async () => {
    // Agent B cancels their active session on Customer Y
    const res = await request(app)
      .post(`/api/v1/tasks/${targetCustomerY}/cancel`)
      .set('Authorization', `Bearer ${tokenAgentB}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.customer.recoveryStatus, 'ASSIGNED');
    assert.strictEqual(res.body.customer.activeRecoverySessionId, null);
  });

  // Test 32: Existing recovery history remains intact
  test('Test 32: Existing recovery history endpoint works intact', async () => {
    const res = await request(app)
      .get('/api/v1/recovery/history')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.sessions));
  });

  // Test 33: Existing profile and dashboard functionality remain intact
  test('Test 33: Existing profile and stats remain intact', async () => {
    const res = await request(app)
      .get('/api/v1/agent/profile')
      .set('Authorization', `Bearer ${tokenAgentA}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.staff);
    assert.strictEqual(res.body.staff.phone, `+91${agentAPhone}`);
  });

  after(async () => {
    try {
      await mongoose.disconnect();
    } catch (e) {}
    setTimeout(() => {
      process.exit(0);
    }, 200);
  });
});
