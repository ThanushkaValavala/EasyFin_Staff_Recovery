const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Staff = require('../models/Staff');
const OtpRecord = require('../models/OtpRecord');
const memoryStore = require('../services/store');
const { getIsConnected } = require('../config/db');
const { generateStrongPassword } = require('../services/passwordGenerator');

const generateToken = (staff) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is not configured in .env');
  }

  return jwt.sign(
    {
      id: staff._id.toString(),
      employeeId: staff.employeeId,
      email: staff.email,
      role: staff.role
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
const otpFallbackStore = new Map(); // phone -> { otp, expiresAt } — only used offline

exports.generateOtp = async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    if (!phone || phone.length < 7) {
      return res.status(400).json({ success: false, message: 'Valid phone number is required.' });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (getIsConnected()) {
      // Remove any existing OTP for this phone, then insert a fresh one
      await OtpRecord.deleteMany({ phone });
      await OtpRecord.create({ phone, otp, expiresAt });
      console.log(`[OTP] Stored in MongoDB for phone ${phone}, expires ${expiresAt.toISOString()}`);
    } else {
      // MongoDB unavailable — fall back to memory (OTP will be lost on restart)
      otpFallbackStore.set(phone, { otp, expiresAt: expiresAt.getTime() });
      console.warn('[OTP] MongoDB unavailable — using in-memory fallback for phone', phone);
    }

    // For demo: return the OTP in the response so it shows on screen
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
    const phone = String(req.body.phone || '').trim();
    const otp = String(req.body.otp || '').trim();

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });
    }

    let otpValid = false;

    if (getIsConnected()) {
      // Look up the valid, unexpired OTP in MongoDB
      const record = await OtpRecord.findOne({
        phone,
        expiresAt: { $gt: new Date() }, // not expired
      });

      if (!record) {
        // Check if an expired record exists (for a better error message)
        const expired = await OtpRecord.findOne({ phone });
        if (expired) {
          // Clean it up
          await OtpRecord.deleteMany({ phone });
          return res.status(400).json({ success: false, message: 'OTP has expired. Request a new one.' });
        }
        return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
      }

      if (record.otp !== otp) {
        return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
      }

      // Valid — delete it so it can't be reused
      await OtpRecord.deleteMany({ phone });
      otpValid = true;
      console.log(`[OTP] Verified and consumed for phone ${phone}`);
    } else {
      // MongoDB unavailable — check fallback store
      const stored = otpFallbackStore.get(phone);
      if (!stored) {
        return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
      }
      if (Date.now() > stored.expiresAt) {
        otpFallbackStore.delete(phone);
        return res.status(400).json({ success: false, message: 'OTP has expired. Request a new one.' });
      }
      if (stored.otp !== otp) {
        return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
      }
      otpFallbackStore.delete(phone);
      otpValid = true;
      console.warn('[OTP] Verified via in-memory fallback (MongoDB was unavailable)');
    }

    if (!otpValid) {
      return res.status(400).json({ success: false, message: 'OTP verification failed.' });
    }

    // Look up staff by phone number (or create a demo staff record)
    let staff = null;
    if (getIsConnected()) {
      staff = await Staff.findOne({ phone });
    } else {
      await memoryStore.initDefaults();
      staff = memoryStore.staffList.find((s) => s.phone === phone);
    }

    // If no matching staff, create a temporary demo profile
    if (!staff) {
      if (getIsConnected()) {
        try {
          staff = await Staff.create({
            employeeId: `PHONE_${phone.replace(/\D/g, '').slice(-8)}`,
            name: 'Demo Agent',
            username: `agent_${phone.replace(/\D/g, '').slice(-10)}`,
            phone,
            email: `demo_${phone.replace(/\D/g, '')}@easyfin.demo`,
            assignedArea: 'Demo Area',
            role: 'field_officer',
            password: 'Demo@1234Secure',
            isActive: true,
          });
        } catch (e) {
          if (e.code === 11000) {
            staff = await Staff.findOne({ phone });
            if (!staff) staff = await Staff.findOne({ email: `demo_${phone.replace(/\D/g, '')}@easyfin.demo` });
          } else {
            throw e;
          }
        }
      } else {
        await memoryStore.initDefaults();
        const demoStaff = {
          _id: `5f43a0b1c2d3e4f5a6b7c8d9`,
          employeeId: 'DEMO001',
          name: 'Demo Agent',
          phone,
          email: `demo_${phone}@easyfin.demo`,
          role: 'field_officer',
          assignedArea: 'Demo Area',
          isActive: true,
        };
        memoryStore.staffList.push(demoStaff);
        staff = demoStaff;
      }
    }

    const token = jwt.sign(
      { id: staff._id.toString(), phone, role: staff.role || 'field_officer' },
      process.env.JWT_SECRET || 'demo_secret',
      { expiresIn: '7d' }
    );

    const safeStaff = typeof staff.toJSON === 'function' ? staff.toJSON() : { ...staff };
    delete safeStaff.password;

    return res.status(200).json({ success: true, token, staff: safeStaff });
  } catch (error) {
    console.error('verifyOtp error:', error);
    return res.status(500).json({ success: false, message: 'OTP verification failed.' });
  }
};
