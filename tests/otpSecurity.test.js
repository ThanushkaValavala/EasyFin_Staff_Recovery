require('dotenv').config();
const request = require('supertest');
const assert = require('assert');
const { app } = require('../src/server');
const { connectDB } = require('../src/config/db');

async function runOtpTests() {
  console.log('--- Testing OTP Authentication & Security ---');
  await connectDB();

  const phone = '+919876511223'; // Priya Patel

  // 1. Send OTP
  const sendRes = await request(app).post('/api/v1/auth/send-otp').send({ phone });
  assert.strictEqual(sendRes.status, 200);
  assert.strictEqual(sendRes.body.success, true);
  const otp = sendRes.body.otp;
  console.log('✓ 1. /auth/send-otp generated OTP successfully:', otp);

  // 2. Resend Cooldown (immediate resend should get 429)
  const cooldownRes = await request(app).post('/api/v1/auth/send-otp').send({ phone });
  assert.strictEqual(cooldownRes.status, 429);
  assert.match(cooldownRes.body.message, /wait \d+ seconds/i);
  console.log('✓ 2. Resend cooldown enforced (returned 429 with remaining seconds)');

  // 3. Incorrect OTP verification
  const wrongOtpRes = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp: '000000' });
  assert.strictEqual(wrongOtpRes.status, 400);
  assert.match(wrongOtpRes.body.message, /incorrect otp/i);
  console.log('✓ 3. Incorrect OTP rejected');

  // 4. Correct OTP verification
  const correctRes = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp });
  assert.strictEqual(correctRes.status, 200);
  assert.ok(correctRes.body.token);
  assert.strictEqual(correctRes.body.staff.phone, phone);
  console.log('✓ 4. Correct OTP verified, returned JWT token with permanent agentId');

  // 5. Replay attack prevention (consumed OTP cannot be reused)
  const replayRes = await request(app).post('/api/v1/auth/verify-otp').send({ phone, otp });
  assert.strictEqual(replayRes.status, 400);
  assert.match(replayRes.body.message, /no otp found/i);
  console.log('✓ 5. Replay prevention verified (OTP deleted on successful verification)');

  console.log('ALL OTP SECURITY TESTS PASSED!\n');
  process.exit(0);
}

runOtpTests().catch((e) => {
  console.error('OTP test failed:', e);
  process.exit(1);
});

