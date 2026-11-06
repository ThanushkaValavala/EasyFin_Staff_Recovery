const RecoveryReport = require('../models/RecoveryReport');
const Assignment = require('../models/Assignment');
const Loan = require('../models/Loan');
const memoryStore = require('../services/store');
const { getIsConnected } = require('../config/db');

exports.getDashboardStats = async (req, res) => {
  try {
    const staffId = req.staff._id.toString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (getIsConnected()) {
      const assignments = await Assignment.find({ staffId }).populate('loanId');
      const todayReports = await RecoveryReport.find({ staffId, submittedAt: { $gte: today } });
      const allReports = await RecoveryReport.find({ staffId });

      let totalAssignedToday = 0;
      let pendingCases = 0;
      let completedCases = 0;
      let partialCases = 0;
      let inProgressCases = 0;

      assignments.forEach(a => {
        totalAssignedToday++; // TEST MODE: Count all assigned

        const loan = a.loanId;
        if (a.recoveryStatus === 'IN_PROGRESS') {
          inProgressCases++;
        } else if (loan && loan.outstandingAmount <= 0) {
          completedCases++;
        } else if (loan && loan.outstandingAmount < loan.totalAmount) {
          partialCases++;
        } else if (['PENDING', 'FOLLOW_UP_REQUIRED'].includes(a.recoveryStatus)) {
          pendingCases++;
        }
      });

      const totalRecoveredAmount = allReports.reduce((sum, r) => sum + (r.paymentAmount || 0), 0);
      const todayRecoveredAmount = totalRecoveredAmount; // TEST MODE: Today = Total

      return res.status(200).json({
        success: true,
        stats: {
          totalAssigned: assignments.length,
          totalAssignedToday, pendingCases, partialCases, completedCases, inProgressCases,
          todayRecoveredAmount, totalRecoveredAmount,
          todayVisitsCount: todayReports.length,
          totalVisitsCount: allReports.length
        }
      });
    } else {
      // Memory Store fallback
      await memoryStore.initDefaults();
      const assignments = memoryStore.assignments.filter(a => a.staffId === staffId);
      const reports = memoryStore.reports.filter(r => r.staffId === staffId);

      let totalAssignedToday = 0;
      let pendingCases = 0;
      let completedCases = 0;
      let partialCases = 0;
      let inProgressCases = 0;

      assignments.forEach(a => {
        totalAssignedToday++; 
        const loan = memoryStore.loans.find(l => l._id === a.loanId) || {};
        
        if (a.recoveryStatus === 'IN_PROGRESS') inProgressCases++;
        else if (loan.outstandingAmount <= 0) completedCases++;
        else if (loan.outstandingAmount < loan.totalAmount) partialCases++;
        else if (['PENDING', 'FOLLOW_UP_REQUIRED'].includes(a.recoveryStatus)) pendingCases++;
      });

      const totalRecoveredAmount = reports.reduce((sum, r) => sum + (r.paymentAmount || 0), 0);
      const todayRecoveredAmount = totalRecoveredAmount; 

      return res.status(200).json({
        success: true,
        stats: {
          totalAssigned: assignments.length,
          totalAssignedToday, pendingCases, partialCases, completedCases, inProgressCases,
          todayRecoveredAmount, totalRecoveredAmount,
          todayVisitsCount: reports.length,
          totalVisitsCount: reports.length
        }
      });
    }
  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ success: false, message: 'Failed to compute dashboard metrics.' });
  }
};

exports.getCollectionHistory = async (req, res) => {
  try {
    const staffId = req.staff._id.toString();
    let reports;

    if (getIsConnected()) {
      reports = await RecoveryReport.find({ staffId }).sort({ submittedAt: -1 });
    } else {
      await memoryStore.initDefaults();
      reports = memoryStore.reports.filter(r => r.staffId === staffId).reverse();
    }

    const collections = reports
      .filter(r => r.paymentAmount > 0)
      .map(r => ({
        id: r._id,
        customerName: r.customerName,
        amount: r.paymentAmount,
        collectedAt: r.submittedAt,
        notes: r.visitNotes || 'Recovery collection'
      }));

    return res.status(200).json({ success: true, collections });
  } catch (error) {
    console.error('Error fetching collections:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch collections.' });
  }
};