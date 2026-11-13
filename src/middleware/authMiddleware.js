const jwt = require('jsonwebtoken');
const { getModels, isBranchDbConnected } = require('../config/branchDb');

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

    const branch = decoded.branch;
    if (!branch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or missing branch in token. Please log in again.'
      });
    }

    const models = getModels(branch);
    if (!models) {
      return res.status(401).json({
        success: false,
        message: 'Invalid branch. Please log in again.'
      });
    }

    if (!isBranchDbConnected(branch)) {
      return res.status(503).json({
        success: false,
        message: 'Database service unavailable for this branch. Please try again.'
      });
    }

    const agentId = decoded.agentId || decoded.id;
    const Staff = models.Staff;
    const staff = await Staff.findById(agentId).select('-password');

    if (!staff || !staff.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Agent account not found or deactivated.'
      });
    }

    req.staff = staff;
    req.agent = staff;
    req.branch = branch;
    req.models = models;

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.'
    });
  }
};

module.exports = { protect };
