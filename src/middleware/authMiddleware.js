const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
const memoryStore = require('../services/store');
const { getIsConnected } = require('../config/db');

const protect = async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Authentication token required.'
    });
  }

  try {
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    if (getIsConnected()) {
      const staff = await Staff.findById(decoded.id).select('-password');
      if (!staff || !staff.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Staff account not found or deactivated.'
        });
      }
      req.staff = staff;
    } else {
      const staff = memoryStore.staffList.find(s => s._id === decoded.id || s.employeeId === decoded.employeeId);
      if (!staff || !staff.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Staff account not found or deactivated.'
        });
      }
      const staffSafe = { ...staff };
      delete staffSafe.password;
      req.staff = staffSafe;
    }

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.'
    });
  }
};

module.exports = { protect };
