const Assignment = require('../models/Assignment');
const Customer = require('../models/Customer');
const Loan = require('../models/Loan');
const memoryStore = require('../services/store');
const { getIsConnected } = require('../config/db');

const maskCustomer = (c) => {
  if (!c) return c;
  const obj = typeof c.toObject === 'function' ? c.toObject() : { ...c };
  if (obj.aadhaar) obj.aadhaar = 'XXXX XXXX ' + String(obj.aadhaar).slice(-4);
  return obj;
};

exports.getAssignedCases = async (req, res) => {
  try {
    const staffId = req.staff._id.toString();
    const { search, status, priority } = req.query;

    if (getIsConnected()) {
      // We only query by staff and priority. We will filter by status manually below.
      let query = { staffId };
      if (priority && priority !== 'ALL') {
        query.priority = priority;
      }

      let assignments = await Assignment.find(query)
        .populate('customerId')
        .populate('loanId')
        .sort({ priority: 1, assignedDate: -1 });

      // DYNAMIC FILTERING based on Loan Balance, not text status
      if (status && status !== 'ALL') {
        assignments = assignments.filter(a => {
          const loan = a.loanId;
          const outstanding = loan ? loan.outstandingAmount : 0;
          const total = loan ? loan.totalAmount : 0;

          if (status === 'COMPLETED') {
            return outstanding <= 0; // Fully paid
          } else if (status === 'PARTIALLY_RECOVERED') {
            return outstanding > 0 && outstanding < total; // Partially paid
          } else if (status === 'PENDING') {
            return outstanding === total || ['PENDING', 'FOLLOW_UP_REQUIRED', 'PAYMENT_PROMISED'].includes(a.recoveryStatus);
          } else if (status === 'TODAY') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return new Date(a.assignedDate) >= today;
          }
          return true;
        });
      }

      let cases = assignments.map(a => ({
        assignmentId: a.assignmentId,
        id: a._id,
        priority: a.priority,
        recoveryStatus: a.recoveryStatus,
        notes: a.notes,
        assignedDate: a.assignedDate,
        lastVisitDate: a.lastVisitDate,
        customer: {
          id: a.customerId?._id,
          customerId: a.customerId?.customerId,
          name: a.customerId?.name,
          phone: a.customerId?.phone,
          alternatePhone: a.customerId?.alternatePhone,
          address: a.customerId?.address,
          landmark: a.customerId?.landmark,
          city: a.customerId?.city,
          area: a.customerId?.area,
          latitude: a.customerId?.latitude,
          longitude: a.customerId?.longitude
        },
        loan: {
          id: a.loanId?._id,
          loanId: a.loanId?.loanId,
          loanType: a.loanId?.loanType,
          totalAmount: a.loanId?.totalAmount,
          outstandingAmount: a.loanId?.outstandingAmount,
          overdueAmount: a.loanId?.overdueAmount,
          emiAmount: a.loanId?.emiAmount,
          overdueDays: a.loanId?.overdueDays,
          status: a.loanId?.status,
          loanDate: a.loanId?.loanDate,
          penaltyAmount: a.loanId?.penaltyAmount
        }
      }));

      if (search && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        cases = cases.filter(c => 
          c.customer.name.toLowerCase().includes(q) ||
          c.customer.phone.includes(q) ||
          c.loan.loanId.toLowerCase().includes(q)
        );
      }

      return res.status(200).json({ success: true, count: cases.length, cases });
    } else {
      // Memory Store fallback
      await memoryStore.initDefaults();
      let assignments = memoryStore.assignments.filter(a => a.staffId === staffId);

      if (priority && priority !== 'ALL') {
        assignments = assignments.filter(a => a.priority === priority);
      }

      let cases = assignments.map(a => {
        const customer = memoryStore.customers.find(c => c._id === a.customerId) || {};
        const loan = memoryStore.loans.find(l => l._id === a.loanId) || {};
        return {
          assignmentId: a.assignmentId,
          id: a._id,
          priority: a.priority,
          recoveryStatus: a.recoveryStatus,
          notes: a.notes,
          assignedDate: a.assignedDate,
          lastVisitDate: a.lastVisitDate,
          customer,
          loan
        };
      });

      if (status && status !== 'ALL') {
        cases = cases.filter(c => {
          const outstanding = c.loan ? c.loan.outstandingAmount : 0;
          const total = c.loan ? c.loan.totalAmount : 0;

          if (status === 'COMPLETED') return outstanding <= 0;
          if (status === 'PARTIALLY_RECOVERED') return outstanding > 0 && outstanding < total;
          if (status === 'PENDING') return outstanding === total || ['PENDING', 'FOLLOW_UP_REQUIRED', 'PAYMENT_PROMISED'].includes(c.recoveryStatus);
          if (status === 'TODAY') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return new Date(c.assignedDate) >= today;
          }
          return true;
        });
      }

      if (search && search.trim() !== '') {
        const q = search.trim().toLowerCase();
        cases = cases.filter(c =>
          (c.customer.name && c.customer.name.toLowerCase().includes(q)) ||
          (c.customer.phone && c.customer.phone.includes(q)) ||
          (c.loan.loanId && c.loan.loanId.toLowerCase().includes(q))
        );
      }

      return res.status(200).json({ success: true, count: cases.length, cases });
    }
  } catch (error) {
    console.error('Error fetching cases:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve assigned cases.'
    });
  }
};

exports.getCaseDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const staffId = req.staff._id.toString();

    if (getIsConnected()) {
      const assignment = await Assignment.findOne({
        $or: [{ _id: id }, { assignmentId: id }],
        staffId
      })
        .populate('customerId')
        .populate('loanId');

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: 'Case not found or unauthorized to view.'
        });
      }

      return res.status(200).json({
        success: true,
        caseItem: {
          assignmentId: assignment.assignmentId,
          id: assignment._id,
          priority: assignment.priority,
          recoveryStatus: assignment.recoveryStatus,
          notes: assignment.notes,
          assignedDate: assignment.assignedDate,
          customer: maskCustomer(assignment.customerId),
          loan: assignment.loanId
        }
      });
    } else {
      await memoryStore.initDefaults();
      const assignment = memoryStore.assignments.find(
        a => (a._id === id || a.assignmentId === id) && a.staffId === staffId
      );

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: 'Case not found or unauthorized to view.'
        });
      }

      const customer = memoryStore.customers.find(c => c._id === assignment.customerId);
      const loan = memoryStore.loans.find(l => l._id === assignment.loanId);

      return res.status(200).json({
        success: true,
        caseItem: {
          ...assignment,
          customer,
          loan
        }
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve case details.'
    });
  }
};
const Staff = require('../models/Staff');

// Admin / supervisor adds a customer + loan and assigns it to a staff member.
exports.createCase = async (req, res) => {
  let cust = null;
  let ln = null;
  try {
    if (!['admin', 'recovery_supervisor'].includes(req.staff.role)) {
      return res.status(403).json({ success: false, message: 'Only an admin or supervisor can add cases.' });
    }
    if (!getIsConnected()) {
      return res.status(503).json({ success: false, message: 'Database is not connected.' });
    }

    const body = req.body || {};
    const c = body.customer || {};
    const l = body.loan || {};

    const required = [c.name, c.phone, c.address, c.area, l.loanId, body.employeeId];
    if (required.some((v) => !String(v || '').trim())) {
      return res.status(400).json({
        success: false,
        message: 'employeeId, customer name, phone, address, area and loan number are required.'
      });
    }

    const aadhaar = String(c.aadhaar || '').replace(/\D/g, '');
    if (aadhaar && aadhaar.length !== 12) {
      return res.status(400).json({ success: false, message: 'Aadhaar must be 12 digits.' });
    }

    const total = Number(l.totalAmount);
    const pending = Number(l.pendingAmount !== undefined ? l.pendingAmount : l.outstandingAmount);
    const penalty = Number(l.penaltyAmount || 0);
    if (![total, pending, penalty].every((n) => Number.isFinite(n) && n >= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Loan amount, pending amount and penalty must be valid numbers.'
      });
    }

    const dob = c.dob ? new Date(c.dob) : null;
    const loanDate = l.loanDate ? new Date(l.loanDate) : new Date();
    if ((dob && isNaN(dob.getTime())) || isNaN(loanDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date of birth or loan date.' });
    }

    const staff = await Staff.findOne({
      employeeId: String(body.employeeId).trim().toUpperCase(),
      isActive: true
    });
    if (!staff) {
      return res.status(404).json({ success: false, message: 'No active staff with that Employee ID.' });
    }

    const stamp = Date.now().toString(36).toUpperCase();

    cust = await Customer.create({
      customerId: String(c.customerId || ('CUST-' + stamp)).trim(),
      name: String(c.name).trim(),
      phone: String(c.phone).trim(),
      alternatePhone: String(c.alternatePhone || '').trim(),
      aadhaar,
      dob,
      address: String(c.address).trim(),
      landmark: String(c.landmark || '').trim(),
      city: String(c.city || '').trim(),
      area: String(c.area).trim(),
      latitude: Number(c.latitude) || 0,
      longitude: Number(c.longitude) || 0
    });

    ln = await Loan.create({
      loanId: String(l.loanId).trim().toUpperCase(),
      customerId: cust._id,
      loanType: String(l.loanType || 'Personal Loan').trim(),
      loanDate,
      totalAmount: total,
      outstandingAmount: pending,
      overdueAmount: pending,
      penaltyAmount: penalty,
      emiAmount: Number(l.emiAmount || 0),
      overdueDays: Number(l.overdueDays || 0),
      status: 'OVERDUE'
    });

    const priority = String(body.priority || '').toUpperCase();
    const asg = await Assignment.create({
      assignmentId: 'ASN-' + stamp,
      staffId: staff._id,
      customerId: cust._id,
      loanId: ln._id,
      priority: ['HIGH', 'MEDIUM', 'LOW'].includes(priority) ? priority : 'HIGH',
      recoveryStatus: 'PENDING',
      notes: String(body.notes || '')
    });

    return res.status(201).json({
      success: true,
      message: 'Case created and assigned.',
      case: {
        assignmentId: asg.assignmentId,
        customerId: cust.customerId,
        loanId: ln.loanId,
        assignedTo: staff.employeeId,
        area: cust.area
      }
    });
  } catch (error) {
    if (ln) await Loan.deleteOne({ _id: ln._id }).catch(() => {});
    if (cust) await Customer.deleteOne({ _id: cust._id }).catch(() => {});
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, message: 'This customer ID or loan number already exists.' });
    }
    if (error && error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Create case error:', error);
    return res.status(500).json({ success: false, message: 'Could not create the case.' });
  }
};