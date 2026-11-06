const { v4: uuidv4 } = require('uuid');
const RecoveryReport = require('../models/RecoveryReport');
const RecoverySession = require('../models/RecoverySession');
const Assignment = require('../models/Assignment');
const Customer = require('../models/Customer');
const Loan = require('../models/Loan');
const StopEvent = require('../models/StopEvent');
const Evidence = require('../models/Evidence');
const memoryStore = require('../services/store');
const { getIsConnected } = require('../config/db');
const rules = require('../services/recoveryRules');

exports.submitReport = async (req, res) => {
  try {
    const staffId = req.staff._id.toString();
    const { sessionId, outcome, visitNotes, paymentAmount, promiseDate, durationSeconds, distanceMeters, placesVisited, evidence } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required.' });
    }

    const completionError = await rules.validateCompletion({ sessionId, staffId, paymentAmount, visitNotes });
    if (completionError) {
      return res.status(400).json({ success: false, message: completionError });
    }

    const reportId = `REP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    if (getIsConnected()) {
      const session = await RecoverySession.findOne({ sessionId, staffId });
      if (!session) return res.status(404).json({ success: false, message: 'Recovery session not found.' });

      const assignment = await Assignment.findById(session.assignmentId).populate('customerId').populate('loanId');
      if (!assignment) return res.status(404).json({ success: false, message: 'Associated loan assignment not found.' });

      let finalStops = placesVisited;
      if (!finalStops || finalStops.length === 0) finalStops = await StopEvent.find({ sessionId }).sort({ startTime: 1 });

      let finalEvidence = evidence;
      if (!finalEvidence || finalEvidence.length === 0) finalEvidence = await Evidence.find({ sessionId });

      const report = new RecoveryReport({
        reportId, sessionId, staffId,
        customerId: assignment.customerId._id,
        loanId: assignment.loanId._id,
        staffName: req.staff.name,
        staffEmployeeId: req.staff.employeeId,
        customerName: assignment.customerId.name,
        customerPhone: assignment.customerId.phone,
        customerAddress: assignment.customerId.address,
        loanNumber: assignment.loanId.loanId,
        loanOutstandingAmount: assignment.loanId.outstandingAmount,
        loanOverdueAmount: assignment.loanId.overdueAmount,
        recoveryDate: session.startTime || new Date(),
        startTime: session.startTime,
        endTime: session.endTime || new Date(),
        durationSeconds: durationSeconds || session.durationSeconds || 0,
        distanceMeters: distanceMeters || session.distanceMeters || 0,
        recoveryOutcome: outcome || session.outcome || 'CUSTOMER_CONTACTED',
        paymentAmount: paymentAmount !== undefined ? Number(paymentAmount) : (session.paymentAmount || 0),
        promiseDate: promiseDate ? new Date(promiseDate) : session.promiseDate,
        visitNotes: visitNotes || session.visitNotes || '',
        placesVisited: finalStops || [],
        evidence: finalEvidence || [],
        vehicleType: session.vehicleType || '',
        vehicleNumber: session.vehicleNumber || '',
        startLocation: session.startLocation,
        endLocation: session.endLocation,
        submittedAt: new Date()
      });

      await report.save();

      session.isReportSubmitted = true;
      session.status = 'COMPLETED';
      await session.save();

      // Update loan balance and assignment status for PARTIAL / FULL payments
      if (report.paymentAmount > 0) {
        const loan = await Loan.findById(assignment.loanId._id);
        if (loan) {
          loan.outstandingAmount = Math.max(0, loan.outstandingAmount - report.paymentAmount);
          loan.overdueAmount = Math.max(0, loan.overdueAmount - report.paymentAmount);
          
          let newStatus = 'PARTIALLY_RECOVERED';
          if (loan.outstandingAmount === 0) {
            newStatus = 'COMPLETED';
            loan.status = 'CLOSED';
          }
          
          await loan.save();
          await Assignment.findByIdAndUpdate(assignment._id, { recoveryStatus: newStatus });
        }
      }

      return res.status(201).json({ success: true, message: 'Report generated.', report });
    } else {
      // Memory Store fallback
      await memoryStore.initDefaults();
      const session = memoryStore.sessions.find(s => s.sessionId === sessionId && s.staffId === staffId);
      if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

      const assignment = memoryStore.assignments.find(a => a._id === session.assignmentId || a.assignmentId === session.assignmentId);
      const customer = memoryStore.customers.find(c => c._id === session.customerId) || {};
      const loan = memoryStore.loans.find(l => l._id === session.loanId) || {};

      let finalStops = placesVisited || memoryStore.stops.filter(s => s.sessionId === sessionId);
      let finalEvidence = evidence || memoryStore.evidences.filter(e => e.sessionId === sessionId);

      const report = {
        _id: `rep_${Date.now()}`, reportId, sessionId, staffId,
        customerId: customer._id || session.customerId,
        loanId: loan._id || session.loanId,
        staffName: req.staff.name,
        staffEmployeeId: req.staff.employeeId,
        customerName: customer.name || 'Customer',
        customerPhone: customer.phone || 'Phone',
        customerAddress: customer.address || 'Address',
        loanNumber: loan.loanId || 'Loan',
        loanOutstandingAmount: loan.outstandingAmount || 0,
        loanOverdueAmount: loan.overdueAmount || 0,
        recoveryDate: session.startTime || new Date().toISOString(),
        startTime: session.startTime,
        endTime: session.endTime || new Date().toISOString(),
        durationSeconds: durationSeconds || session.durationSeconds || 0,
        distanceMeters: distanceMeters || session.distanceMeters || 0,
        recoveryOutcome: outcome || session.outcome || 'CUSTOMER_CONTACTED',
        paymentAmount: paymentAmount !== undefined ? Number(paymentAmount) : (session.paymentAmount || 0),
        promiseDate: promiseDate || session.promiseDate,
        visitNotes: visitNotes || session.visitNotes || '',
        placesVisited: finalStops || [],
        evidence: finalEvidence || [],
        vehicleType: session.vehicleType || '',
        vehicleNumber: session.vehicleNumber || '',
        startLocation: session.startLocation,
        endLocation: session.endLocation,
        submittedAt: new Date().toISOString()
      };

      memoryStore.reports.push(report);
      session.isReportSubmitted = true;
      session.status = 'COMPLETED';

      if (report.paymentAmount > 0 && loan.outstandingAmount) {
        loan.outstandingAmount = Math.max(0, loan.outstandingAmount - report.paymentAmount);
        loan.overdueAmount = Math.max(0, loan.overdueAmount - report.paymentAmount);
        if (assignment) {
          assignment.recoveryStatus = loan.outstandingAmount === 0 ? 'COMPLETED' : 'PARTIALLY_RECOVERED';
        }
      }

      return res.status(201).json({ success: true, message: 'Report generated.', report });
    }
  } catch (error) {
    console.error('Error submitting report:', error);
    return res.status(500).json({ success: false, message: 'Failed to submit report.' });
  }
};

exports.getReportsHistory = async (req, res) => {
  try {
    const staffId = req.staff._id.toString();
    if (getIsConnected()) {
      const reports = await RecoveryReport.find({ staffId }).sort({ submittedAt: -1 });
      return res.status(200).json({ success: true, count: reports.length, reports });
    } else {
      await memoryStore.initDefaults();
      const reports = memoryStore.reports.filter(r => r.staffId === staffId).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
      return res.status(200).json({ success: true, count: reports.length, reports });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve reports.' });
  }
};

exports.getReportDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const staffId = req.staff._id.toString();
    if (getIsConnected()) {
      const report = await RecoveryReport.findOne({ $or: [{ _id: id }, { reportId: id }], staffId });
      if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
      return res.status(200).json({ success: true, report });
    } else {
      await memoryStore.initDefaults();
      const report = memoryStore.reports.find(r => (r._id === id || r.reportId === id) && r.staffId === staffId);
      if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });
      return res.status(200).json({ success: true, report });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve report.' });
  }
};