const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Staff = require('../models/Staff');
const OtpRecord = require('../models/OtpRecord');
const memoryStore = require('../services/store');
const { getIsConnected } = require('../config/db');
const { getModels, isBranchDbConnected } = require('../config/branchDb');
const { generateStrongPassword } = require('../services/passwordGenerator');
const { normalizePhoneNumber } = require('../utils/phoneNormalizer');
async function isNumberInBranch(branch, phone, BranchMemberModel) {
  if (!BranchMemberModel || !branch || !phone) {
    return false;
  }

  const normalizedPhone = BranchMemberModel.normalize(phone);
  if (!normalizedPhone || normalizedPhone.length !== 10) {
    return false;
  }

  const member = await BranchMemberModel.findOne({ phone: normalizedPhone, branch, isActive: true });
  return !!member;
}

exports.isNumberInBranch = isNumberInBranch;

const generateToken = (staff, branch) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not configured in .env');
  }

  const normalizedPhone = staff.phone ? normalizePhoneNumber(staff.phone) : '';
  const agentBranch = branch || staff.branch || staff.assignedArea || '';

  return jwt.sign(
    {
      id: staff._id.toString(),
      agentId: staff._id.toString(),
      employeeId: staff.employeeId,
      email: staff.email,
      phone: normalizedPhone,
      role: staff.role,
      branch: agentBranch
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const toSafeStaff = (staff) => {
  if (typeof staff.toJSON === 'function') return staff.toJSON();
  const safeStaff = { ...staff };
  delete safeStaff.password;
  return safeStaff;
};

// Password login: Employee ID or email + password
exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID or email and password are required.'
      });
    }

    const trimmed = String(identifier).trim().toLowerCase();
    let staff;

    if (getIsConnected()) {
      staff = await Staff.findOne({
        $or: [
          { email: trimmed },
          { employeeId: trimmed.toUpperCase() }
        ]
      });

      if (!staff) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials or staff member not found.'
        });
      }

      const isMatch = await staff.comparePassword(password);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.'
        });
      }
    } else {
      await memoryStore.initDefaults();

      staff = memoryStore.staffList.find(
        s =>
          s.email.toLowerCase() === trimmed ||
          s.employeeId.toLowerCase() === trimmed
      );

      if (!staff || !(await bcrypt.compare(password, staff.password))) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.'
        });
      }
    }

    if (!staff.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      token: generateToken(staff),
      staff: toSafeStaff(staff)
    });
  } catch (error) {
    console.error('Login error:', error);

    return res.status(500).json({
      success: false,
      message: 'Authentication failed.'
    });
  }
};

// Admin / supervisor creates a staff user. Password is auto-generated and shown once.
exports.createStaff = async (req, res) => {
  try {
    if (!['admin', 'recovery_supervisor'].includes(req.staff.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only an admin or supervisor can create staff users.'
      });
    }

    if (!getIsConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Database is not connected. Cannot create users right now.'
      });
    }

    const { employeeId, name, email, phone, assignedArea, role } = req.body;

    if (!employeeId || !name || !email || !phone || !assignedArea) {
      return res.status(400).json({
        success: false,
        message: 'employeeId, name, email, phone and assignedArea are required.'
      });
    }

    let newRole = 'field_officer';
    if (role && role !== 'field_officer') {
      if (req.staff.role !== 'admin' || !['recovery_supervisor', 'admin'].includes(role)) {
        return res.status(403).json({
          success: false,
          message: 'Only an admin can create supervisor or admin users.'
        });
      }
      newRole = role;
    }

    const generatedPassword = generateStrongPassword();

    const staff = await Staff.create({
      employeeId: String(employeeId).trim().toUpperCase(),
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      phone: String(phone).trim(),
      assignedArea: String(assignedArea).trim(),
      role: newRole,
      password: generatedPassword,
      isActive: true
    });

    return res.status(201).json({
      success: true,
      message: 'Staff created. Share this password securely. It will not be shown again.',
      staff: staff.toJSON(),
      generatedPassword
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A staff member with this Employee ID or email already exists.'
      });
    }
    console.error('Create staff error:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not create staff user.'
    });
  }
};

exports.getProfile = async (req, res) => {
  return res.status(200).json({
    success: true,
    staff: req.staff
  });
};
// Sign up: requires SIGNUP_CODE (set in Render Environment). Role is always field_officer.
exports.register = async (req, res) => {
  try {
    const { employeeId, name, email, phone, assignedArea, password, signupCode } = req.body;

    if (!process.env.SIGNUP_CODE || signupCode !== process.env.SIGNUP_CODE) {
      return res.status(403).json({ success: false, message: 'Invalid sign-up code.' });
    }
    if (!employeeId || !name || !email || !phone || !assignedArea || !password) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }
    if (!getIsConnected()) {
      return res.status(503).json({ success: false, message: 'Database not connected.' });
    }

    // Build a unique username from employeeId
    const username = String(employeeId).trim().toLowerCase().replace(/[^a-z0-9]/g, '_');

    await Staff.create({
      employeeId: String(employeeId).trim().toUpperCase(),
      name: String(name).trim(),
      username,
      email: String(email).trim().toLowerCase(),
      phone: String(phone).trim(),
      assignedArea: String(assignedArea).trim(),
      role: 'field_officer',
      password,
      isActive: true
    });

    return res.status(201).json({ success: true, message: 'Account created. You can log in now.' });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ success: false, message: 'Employee ID or email already exists.' });
    }
    return res.status(500).json({ success: false, message: 'Could not create account.' });
  }
};

// ─── OTP ENDPOINTS ──────────────────────────────────────────────────────────
// OTPs are persisted in MongoDB via the OtpRecord model with a TTL index.
// This survives server restarts and Render cold-starts.
// Falls back to an in-memory store only if MongoDB is unavailable.
const otpFallbackStore = new Map(); // phone -> { otp, expiresAt, attempts, lastSentAt } — only used offline
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds resend cooldown
const MAX_VERIFY_ATTEMPTS = 5;

exports.generateOtp = async (req, res) => {
  try {
    const rawBranch = req.body.branch;
    const branch = rawBranch ? String(rawBranch).trim() : '';
    if (!branch) {
      return res.status(400).json({ success: false, message: 'Please select a branch.' });
    }

    const rawPhone = String(req.body.phone || '').trim();
    const phone = normalizePhoneNumber(rawPhone);
    if (!phone || phone.length < 8) {
      return res.status(400).json({ success: false, message: 'Valid phone number is required.' });
    }

    if (!isBranchDbConnected(branch)) {
      return res.status(503).json({
        success: false,
        message: 'Verification service unavailable. Try again.'
      });
    }

    const models = getModels(branch);
    if (!models) {
      return res.status(503).json({
        success: false,
        message: 'Verification service unavailable. Try again.'
      });
    }
    const { BranchMember: BranchMemberModel, OtpRecord: OtpRecordModel } = models;

    const isAllowed = await isNumberInBranch(branch, rawPhone, BranchMemberModel);
    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: 'This number is not registered under the selected branch.'
      });
    }

    const now = Date.now();

    // Check resend cooldown
    const existing = await OtpRecordModel.findOne({ phone });
    if (existing && existing.lastSentAt) {
      const elapsed = now - new Date(existing.lastSentAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec} seconds before requesting another OTP.`
        });
      }
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(now + 10 * 60 * 1000); // 10 minutes

    await OtpRecordModel.deleteMany({ phone });
    await OtpRecordModel.create({ phone, otp, expiresAt, attempts: 0, lastSentAt: new Date(now) });
    console.log(`[OTP] Stored in MongoDB for phone ${phone}, expires ${expiresAt.toISOString()}`);

    return res.status(200).json({
      success: true,
      message: 'OTP generated.',
      otp, // visible for demo
      phone,
    });
  } catch (error) {
    console.error('generateOtp error:', error);
    return res.status(500).json({ success: false, message: 'Could not generate OTP.' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const rawBranch = req.body.branch;
    const branch = rawBranch ? String(rawBranch).trim() : '';
    if (!branch) {
      return res.status(400).json({ success: false, message: 'Please select a branch.' });
    }

    const rawPhone = String(req.body.phone || '').trim();
    const phone = normalizePhoneNumber(rawPhone);
    const otp = String(req.body.otp || '').trim();

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });
    }

    if (!isBranchDbConnected(branch)) {
      return res.status(503).json({
        success: false,
        message: 'Verification service unavailable. Try again.'
      });
    }

    const models = getModels(branch);
    if (!models) {
      return res.status(503).json({
        success: false,
        message: 'Verification service unavailable. Try again.'
      });
    }
    const { BranchMember: BranchMemberModel, OtpRecord: OtpRecordModel, Staff: StaffModel } = models;

    const isAllowed = await isNumberInBranch(branch, rawPhone, BranchMemberModel);
    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: 'This number is not registered under the selected branch.'
      });
    }

    let otpValid = false;

    const record = await OtpRecordModel.findOne({ phone });

    if (!record) {
      return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
    }

    if (new Date() > new Date(record.expiresAt)) {
      await OtpRecordModel.deleteMany({ phone });
      return res.status(400).json({ success: false, message: 'OTP has expired. Request a new one.' });
    }

    // Check max attempts
    if ((record.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
      await OtpRecordModel.deleteMany({ phone });
      return res.status(429).json({
        success: false,
        message: 'Maximum verification attempts exceeded. Please request a new OTP.'
      });
    }

    if (record.otp !== otp) {
      await OtpRecordModel.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
      return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
    }

    // Valid — delete it so it can't be reused
    await OtpRecordModel.deleteMany({ phone });
    otpValid = true;
    console.log(`[OTP] Verified and consumed for phone ${phone}`);

    if (!otpValid) {
      return res.status(400).json({ success: false, message: 'OTP verification failed.' });
    }

    // Look up staff by normalized phone number (or create a permanent agent record)
    let staff = await StaffModel.findOne({ phone });

    // If no matching staff, create a permanent agent profile
    if (!staff) {
      try {
        staff = await StaffModel.create({
          employeeId: `PHONE_${phone.replace(/\D/g, '').slice(-8)}`,
          name: 'Demo Agent',
          username: `agent_${phone.replace(/\D/g, '').slice(-10)}`,
          phone,
          email: `demo_${phone.replace(/\D/g, '')}@easyfin.demo`,
          assignedArea: branch,
          role: 'field_officer',
          password: 'Demo@1234Secure',
          isActive: true,
        });
      } catch (e) {
        if (e.code === 11000) {
          staff = await StaffModel.findOne({ phone });
          if (!staff) staff = await StaffModel.findOne({ email: `demo_${phone.replace(/\D/g, '')}@easyfin.demo` });
        } else {
          throw e;
        }
      }
    }

    const token = generateToken(staff, branch);

    const safeStaff = typeof staff.toJSON === 'function' ? staff.toJSON() : { ...staff };
    delete safeStaff.password;

    return res.status(200).json({ success: true, token, staff: safeStaff });
  } catch (error) {
    console.error('verifyOtp error:', error);
    return res.status(500).json({ success: false, message: 'OTP verification failed.' });
  }
};
