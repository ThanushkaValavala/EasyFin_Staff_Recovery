require('dotenv').config();
const request = require('supertest');
const assert = require('assert');
const { app } = require('../src/server');
const mongoose = require('mongoose');
const Staff = require('../src/models/Staff');
const RecoverySession = require('../src/models/RecoverySession');

async function testMultiDevice() {
  console.log('====================================================');
  console.log('MULTI-DEVICE RECOVERY PERSISTENCE TEST');
  console.log('====================================================\n');

  const { connectDB } = require('../src/config/db');
  await connectDB();

  const testPhone = '+919876543210'; // Rohan Sharma

  // Step 1: Device A Login
  console.log('1. Device A: Generating and verifying OTP for', testPhone);
  const otpRes = await request(app).post('/api/v1/auth/otp/generate').send({ phone: testPhone });
  assert.strictEqual(otpRes.status, 200);
  const otp = otpRes.body.otp;
  console.log('   Device A: OTP generated:', otp);

  const verifyA = await request(app).post('/api/v1/auth/otp/verify').send({ phone: testPhone, otp });
  assert.strictEqual(verifyA.status, 200);
  const tokenA = verifyA.body.token;
  const staffA = verifyA.body.staff;
  console.log('   Device A: Verified! agentId =', staffA._id, 'name =', staffA.name, 'phone =', staffA.phone);

  // Check history on Device A before test
  const histBeforeRes = await request(app)
    .get('/api/v1/recovery/history')
    .set('Authorization', 'Bearer ' + tokenA);
  assert.strictEqual(histBeforeRes.status, 200);
  const beforeCount = histBeforeRes.body.sessions.length;
  console.log('   Device A: Initial completed recoveries count =', beforeCount);

  // Step 2: Device B Login with SAME mobile number
  console.log('\n2. Device B: Generating and verifying OTP for SAME number:', testPhone);
  const otpResB = await request(app).post('/api/v1/auth/otp/generate').send({ phone: testPhone });
  const otpB = otpResB.body.otp;

  const verifyB = await request(app).post('/api/v1/auth/otp/verify').send({ phone: testPhone, otp: otpB });
  assert.strictEqual(verifyB.status, 200);
  const tokenB = verifyB.body.token;
  const staffB = verifyB.body.staff;
  console.log('   Device B: Verified! agentId =', staffB._id, 'name =', staffB.name, 'phone =', staffB.phone);

  // Assert SAME agent ID
  assert.strictEqual(staffA._id.toString(), staffB._id.toString(), 'Agent ID on Device A and Device B must match identically!');
  console.log('   ✅ CONFIRMED: Same agentId across Device A and Device B:', staffA._id);

  // Verify Device B sees all existing recoveries
  const histBRes = await request(app)
    .get('/api/v1/recovery/history')
    .set('Authorization', 'Bearer ' + tokenB);
  assert.strictEqual(histBRes.status, 200);
  console.log('   Device B: Recoveries count =', histBRes.body.sessions.length);
  assert.strictEqual(histBRes.body.sessions.length, beforeCount, 'Device B must see the exact same recoveries as Device A!');

  // Step 3: Device B completes a new recovery (sync walk recovery)
  console.log('\n3. Device B: Completing a new recovery session...');
  const newDeviceSessionId = `test_device_sess_${Date.now()}`;
  const syncRes = await request(app)
    .post('/api/v1/recovery/sync')
    .set('Authorization', 'Bearer ' + tokenB)
    .send({
      deviceSessionId: newDeviceSessionId,
      vehicleType: 'WALK',
      remarks: 'Customer paid 5000 in cash to field agent on Device B',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date().toISOString()
    });
  assert.ok(syncRes.status === 200 || syncRes.status === 201);
  console.log('   Device B: Successfully persisted recovery! Session ID =', syncRes.body.session.sessionId);
  assert.strictEqual(syncRes.body.session.agentId.toString(), staffA._id.toString());

  // Step 4: Device A refreshes history
  console.log('\n4. Device A: Refreshing recovery history...');
  const histAfterRes = await request(app)
    .get('/api/v1/recovery/history')
    .set('Authorization', 'Bearer ' + tokenA);
  assert.strictEqual(histAfterRes.status, 200);
  const afterCount = histAfterRes.body.sessions.length;
  console.log('   Device A: New completed recoveries count =', afterCount);
  assert.strictEqual(afterCount, beforeCount + 1, 'Device A must see the new recovery created on Device B!');

  const foundNewSession = histAfterRes.body.sessions.find(s => s.deviceSessionId === newDeviceSessionId);
  assert.ok(foundNewSession, 'Device A must find the exact session created by Device B');
  console.log('   ✅ CONFIRMED: Device A retrieved the recovery created on Device B.');
  console.log('   NLP Summary:', foundNewSession.nlpSummary, '| Category:', foundNewSession.nlpCategory);

  console.log('\n====================================================');
  console.log('ALL MULTI-DEVICE PERSISTENCE ASSERTIONS PASSED!');
  console.log('====================================================\n');

  process.exit(0);
}

testMultiDevice().catch(err => {
  console.error('Multi-device test failed:', err);
  process.exit(1);
});
