const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const flow = require('../controllers/recoveryFlowController');

// GET /agent/profile — returns agent info + live recovery stats from DB
router.get('/profile', protect, async (req, res) => {
  try {
    const staff = req.staff;
    // Also attach live stats computed from RecoverySession collection
    try {
      const mongoose = require('mongoose');
      const RecoverySession = req.models.RecoverySession;
      const agentId = staff._id;
      const staffId = agentId.toString();

      const [count, distResult] = await Promise.all([
        RecoverySession.countDocuments({
          $or: [{ agentId }, { staffId }],
          status: 'COMPLETED',
        }),
        RecoverySession.aggregate([
          {
            $match: {
              $or: [
                { agentId: mongoose.Types.ObjectId.isValid(agentId) ? new mongoose.Types.ObjectId(agentId) : agentId },
                { staffId }
              ],
              status: 'COMPLETED'
            }
          },
          { $group: { _id: null, totalMeters: { $sum: '$distanceMeters' } } },
        ]),
      ]);

      const totalDistanceKm = distResult.length ? (distResult[0].totalMeters / 1000) : 0;

      const safeStaff = typeof staff.toJSON === 'function' ? staff.toJSON() : { ...staff.toObject ? staff.toObject() : staff };
      safeStaff.recoveryCount = count;
      safeStaff.totalDistanceKm = parseFloat(totalDistanceKm.toFixed(3));

      return res.status(200).json({ success: true, staff: safeStaff });
    } catch (statsErr) {
      console.error('[agent/profile] Stats computation failed:', statsErr.message);
      // Return profile without fresh stats
      const safeStaff = typeof staff.toJSON === 'function' ? staff.toJSON() : staff;
      return res.status(200).json({ success: true, staff: safeStaff });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not load profile.' });
  }
});

module.exports = router;
