const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Staff = require('../models/Staff');
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