const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { getSignedUrl } = require('../services/storage');

const VOICE_BUCKET = process.env.SUPABASE_VOICE_BUCKET || 'voice-notes';
const STALE_LOCK_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// Helper to format date & time
const formatDateTime = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return {
    date: `${year}-${month}-${day}`,
    time: `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
  };
};

/**
 * GET /api/v1/tasks
 * Retrieves assigned tasks for the logged-in agent (excluding COMPLETED)
 */
exports.getAssignedTasks = async (req, res) => {
  try {
    const { Customer, Assignment, RecoverySession } = req.models || {};
    if (!Customer) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const agentId = req.agent._id;
    const agentStr = agentId.toString();
    const { search, location, area } = req.query;

    // 1. Gather all customer IDs assigned to this agent from Assignment collection
    let assignedFromAssignments = [];
    if (Assignment) {
      const asgDocs = await Assignment.find({
        $or: [{ agentId }, { staffId: agentStr }]
      }).select('customerId').lean();
      assignedFromAssignments = asgDocs.map((a) => a.customerId).filter(Boolean);
    }

    // 2. Build query for customers assigned to this agent
    const customerFilter = {
      recoveryStatus: { $ne: 'COMPLETED' },
      $or: [
        { assignedRecoveryAgentId: agentId },
        { assignedRecoveryAgentId: agentStr },
        { assignedRecoveryAgentIds: agentId },
        { assignedRecoveryAgentIds: agentStr },
        ...(assignedFromAssignments.length ? [{ _id: { $in: assignedFromAssignments } }] : [])
      ]
    };

    // Location / Locality filter (Sarjapur, Kasavanahalli, Marathahalli, etc.)
    const locParam = String(location || area || '').trim();
    if (locParam && locParam.toLowerCase() !== 'all' && locParam.toLowerCase() !== 'all locations') {
      const locRegex = new RegExp(locParam, 'i');
      customerFilter.$and = [
        {
          $or: [
            { area: locRegex },
            { location: locRegex },
            { fullAddress: locRegex },
            { address: locRegex },
            { city: locRegex }
          ]
        }
      ];
    }

    // Search filter
    const searchParam = String(search || '').trim();
    if (searchParam) {
      const sRegex = new RegExp(searchParam, 'i');
      const searchOr = [
        { name: sRegex },
        { customerName: sRegex },
        { phone: sRegex },
        { phoneNumber: sRegex },
        { address: sRegex },
        { fullAddress: sRegex },
        { customerId: sRegex }
      ];
      if (customerFilter.$and) {
        customerFilter.$and.push({ $or: searchOr });
      } else {
        customerFilter.$and = [{ $or: searchOr }];
      }
    }

    const customers = await Customer.find(customerFilter).sort({ updatedAt: -1 }).lean();

    // 3. Enhance customer items with active session & lock state
    const tasks = await Promise.all(
      customers.map(async (c) => {
        const isLocked = c.recoveryStatus === 'RECOVERY_IN_PROGRESS';
        const lockAgentStr = c.activeRecoveryAgentId ? c.activeRecoveryAgentId.toString() : '';
        const isLockedByMe = isLocked && lockAgentStr === agentStr;
        const isLockedByOther = isLocked && lockAgentStr && lockAgentStr !== agentStr;

        let activeSession = null;
        let isSessionSubmitted = false;
        let canComplete = false;

        if (isLockedByMe && c.activeRecoverySessionId && RecoverySession) {
          activeSession = await RecoverySession.findOne({
            sessionId: c.activeRecoverySessionId
          }).lean();
          if (activeSession && activeSession.status === 'COMPLETED') {
            isSessionSubmitted = true;
            canComplete = true; // Stage 1 submitted, ready for Stage 2 task completion
          }
        }

        return {
          id: c._id,
          customerId: c.customerId,
          customerName: c.customerName || c.name,
          phoneNumber: c.phoneNumber || c.phone,
          fullAddress: c.fullAddress || c.address,
          city: c.city || '',
          location: c.location || c.area || '',
          area: c.area || c.location || '',
          latitude: c.latitude || 0,
          longitude: c.longitude || 0,
          recoveryStatus: c.recoveryStatus || 'ASSIGNED',
          activeRecoverySessionId: c.activeRecoverySessionId || null,
          activeRecoveryAgentId: c.activeRecoveryAgentId || null,
          activeAgentName: c.activeAgentName || '',
          activeAgentPhone: c.activeAgentPhone || '',
          isLockedByMe,
          isLockedByOther,
          isSessionSubmitted,
          canComplete,
          activeSession: activeSession
            ? {
                sessionId: activeSession.sessionId,
                status: activeSession.status,
                distanceMeters: activeSession.distanceMeters || 0,
                durationSeconds: activeSession.durationSeconds || 0,
                endTime: activeSession.endTime
              }
            : null
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: tasks.length,
      tasks
    });
  } catch (error) {
    console.error('getAssignedTasks error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve assigned tasks.' });
  }
};

/**
 * GET /api/v1/tasks/completed
 * Retrieves completed tasks for the agent or branch
 */
exports.getCompletedTasks = async (req, res) => {
  try {
    const { CompletedTask } = req.models || {};
    if (!CompletedTask) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const agentId = req.agent._id;
    const { search, location, area, date, outcome } = req.query;

    const filter = {
      $or: [{ agentId }, { agentId: agentId.toString() }]
    };

    // Locality filter
    const locParam = String(location || area || '').trim();
    if (locParam && locParam.toLowerCase() !== 'all' && locParam.toLowerCase() !== 'all locations') {
      const locRegex = new RegExp(locParam, 'i');
      filter.$and = [
        {
          $or: [
            { area: locRegex },
            { location: locRegex },
            { fullAddress: locRegex },
            { city: locRegex }
          ]
        }
      ];
    }

    // Outcome filter
    if (outcome && outcome !== 'ALL') {
      filter.outcome = outcome;
    }

    // Date filter
    if (date) {
      const now = new Date();
      if (date === 'TODAY') {
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filter.completedAt = { $gte: startOfDay };
      } else if (date === 'WEEK') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filter.completedAt = { $gte: weekAgo };
      } else if (date.length === 10) {
        // YYYY-MM-DD
        filter.completionDate = date;
      }
    }

    // Search
    const searchParam = String(search || '').trim();
    if (searchParam) {
      const sRegex = new RegExp(searchParam, 'i');
      const searchOr = [
        { customerName: sRegex },
        { phoneNumber: sRegex },
        { fullAddress: sRegex },
        { customerRefId: sRegex }
      ];
      if (filter.$and) {
        filter.$and.push({ $or: searchOr });
      } else {
        filter.$and = [{ $or: searchOr }];
      }
    }

    const completed = await CompletedTask.find(filter).sort({ completedAt: -1 }).lean();

    // Map and sign voice URLs if needed
    const completedTasks = await Promise.all(
      completed.map(async (t) => {
        let voiceUrl = t.voiceNoteUrl || '';
        if (!voiceUrl && t.voiceStoragePath) {
          try {
            voiceUrl = await getSignedUrl(VOICE_BUCKET, t.voiceStoragePath, 3600);
          } catch (_) {}
        }

        const dt = formatDateTime(t.completedAt);

        return {
          id: t._id,
          taskId: t.taskId,
          customerId: t.customerId,
          customerRefId: t.customerRefId,
          customerName: t.customerName,
          phoneNumber: t.phoneNumber,
          fullAddress: t.fullAddress,
          location: t.location || t.area,
          area: t.area || t.location,
          city: t.city || '',
          recoveryAgentName: t.agentName,
          recoveryAgentPhone: t.agentPhone,
          completedAt: t.completedAt,
          completionDate: t.completionDate || dt.date,
          completionTime: t.completionTime || dt.time,
          sessionId: t.sessionId,
          recoverySessionId: t.recoverySessionId,
          distanceMeters: t.distanceMeters || 0,
          durationSeconds: t.durationSeconds || 0,
          voiceNoteUrl: voiceUrl,
          voiceStoragePath: t.voiceStoragePath || '',
          startSpeedometerEvidenceId: t.startSpeedometerEvidenceId || '',
          endSpeedometerEvidenceId: t.endSpeedometerEvidenceId || '',
          startSpeedometerUrl: t.startSpeedometerEvidenceId
            ? `/api/v1/recovery/evidence/${t.startSpeedometerEvidenceId}/image`
            : '',
          endSpeedometerUrl: t.endSpeedometerEvidenceId
            ? `/api/v1/recovery/evidence/${t.endSpeedometerEvidenceId}/image`
            : '',
          outcome: t.outcome || 'COMPLETED',
          visitNotes: t.visitNotes || '',
          visitRemarks: t.visitNotes || ''
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: completedTasks.length,
      completedTasks
    });
  } catch (error) {
    console.error('getCompletedTasks error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve completed tasks.' });
  }
};

/**
 * GET /api/v1/tasks/locations
 * Returns unique localities/areas for the agent's customers
 */
exports.getLocations = async (req, res) => {
  try {
    const { Customer, Assignment } = req.models || {};
    if (!Customer) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const agentId = req.agent._id;
    const agentStr = agentId.toString();

    let assignedFromAssignments = [];
    if (Assignment) {
      const asgDocs = await Assignment.find({
        $or: [{ agentId }, { staffId: agentStr }]
      }).select('customerId').lean();
      assignedFromAssignments = asgDocs.map((a) => a.customerId).filter(Boolean);
    }

    const customers = await Customer.find({
      $or: [
        { assignedRecoveryAgentId: agentId },
        { assignedRecoveryAgentId: agentStr },
        { assignedRecoveryAgentIds: agentId },
        { assignedRecoveryAgentIds: agentStr },
        ...(assignedFromAssignments.length ? [{ _id: { $in: assignedFromAssignments } }] : [])
      ]
    }).select('area location city').lean();

    const locSet = new Set();
    customers.forEach((c) => {
      const loc = c.area || c.location;
      if (loc && String(loc).trim()) {
        locSet.add(String(loc).trim());
      }
    });

    // Ensure standard localities exist for Bangalore testing if assigned
    const standardLocalities = ['Sarjapur', 'Kasavanahalli', 'Marathahalli'];
    standardLocalities.forEach((loc) => {
      if ([...locSet].some((l) => l.toLowerCase() === loc.toLowerCase())) {
        locSet.add(loc);
      }
    });

    const locations = ['All Locations', ...Array.from(locSet).sort()];

    return res.status(200).json({
      success: true,
      locations
    });
  } catch (error) {
    console.error('getLocations error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve task locations.' });
  }
};

/**
 * POST /api/v1/tasks/:customerId/start
 * Atomically acquires recovery lock on the customer and associates a recovery session
 */
exports.startTaskRecovery = async (req, res) => {
  try {
    const { Customer, Assignment, RecoverySession, TaskAuditLog } = req.models || {};
    if (!Customer || !RecoverySession) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const { customerId } = req.params;
    const agentId = req.agent._id;
    const agentStr = agentId.toString();
    const agentName = req.agent.name || 'Recovery Agent';
    const agentPhone = req.agent.phone || '';
    const deviceSessionId = String(req.body.deviceSessionId || '').trim();

    // 1. Find customer
    const customer = await Customer.findOne({
      $or: [
        { customerId },
        ...(mongoose.Types.ObjectId.isValid(customerId) ? [{ _id: customerId }] : [])
      ]
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    // 2. Validate customer assignment
    const isAssigned = (
      (customer.assignedRecoveryAgentId && customer.assignedRecoveryAgentId.toString() === agentStr) ||
      (Array.isArray(customer.assignedRecoveryAgentIds) && customer.assignedRecoveryAgentIds.some((id) => id && id.toString() === agentStr))
    );

    let assignment = null;
    if (Assignment) {
      assignment = await Assignment.findOne({
        customerId: customer._id,
        $or: [{ agentId }, { staffId: agentStr }]
      });
    }

    if (!isAssigned && !assignment) {
      return res.status(403).json({ success: false, message: 'Customer is not assigned to you.' });
    }

    // 3. Validate status
    if (customer.recoveryStatus === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'This customer has already been completed.' });
    }

    // 4. Check if locked by another agent
    const lockAge = customer.lockedAt ? Date.now() - new Date(customer.lockedAt).getTime() : 0;
    const isLockedByOther = (
      customer.recoveryStatus === 'RECOVERY_IN_PROGRESS' &&
      customer.activeRecoveryAgentId &&
      customer.activeRecoveryAgentId.toString() !== agentStr &&
      lockAge < STALE_LOCK_TIMEOUT_MS
    );

    if (isLockedByOther) {
      return res.status(409).json({
        success: false,
        message: 'This customer is currently being handled by another recovery agent.',
        lockedByAgentName: customer.activeAgentName || 'Another recovery agent'
      });
    }

    // If already locked by this agent and has active session, return current session
    if (
      customer.recoveryStatus === 'RECOVERY_IN_PROGRESS' &&
      customer.activeRecoveryAgentId &&
      customer.activeRecoveryAgentId.toString() === agentStr &&
      customer.activeRecoverySessionId
    ) {
      const existingSession = await RecoverySession.findOne({
        sessionId: customer.activeRecoverySessionId
      });
      if (existingSession) {
        return res.status(200).json({
          success: true,
          message: 'Resuming active recovery session for this customer.',
          isExisting: true,
          customer,
          session: existingSession
        });
      }
    }

    // 5. Atomically acquire lock
    const sessionId = `SESS-${Date.now()}-${uuidv4().substring(0, 8)}`;
    const updatedCustomer = await Customer.findOneAndUpdate(
      {
        _id: customer._id,
        $or: [
          { recoveryStatus: { $in: ['ASSIGNED', 'PENDING'] } },
          { recoveryStatus: 'RECOVERY_IN_PROGRESS', activeRecoveryAgentId: agentId },
          { recoveryStatus: 'RECOVERY_IN_PROGRESS', lockedAt: { $lt: new Date(Date.now() - STALE_LOCK_TIMEOUT_MS) } }
        ]
      },
      {
        $set: {
          recoveryStatus: 'RECOVERY_IN_PROGRESS',
          activeRecoverySessionId: sessionId,
          activeRecoveryAgentId: agentId,
          activeAgentName: agentName,
          activeAgentPhone: agentPhone,
          lockedAt: new Date()
        }
      },
      { new: true }
    );

    if (!updatedCustomer) {
      return res.status(409).json({
        success: false,
        message: 'This customer is currently being handled by another recovery agent.'
      });
    }

    // 6. Create associated RecoverySession
    const newSession = await RecoverySession.create({
      sessionId,
      agentId,
      staffId: agentId,
      customerId: customer._id,
      customerRefId: customer.customerId,
      customerName: customer.customerName || customer.name,
      assignmentId: assignment ? assignment._id : null,
      loanId: assignment ? assignment.loanId : null,
      startTime: new Date(),
      status: 'ACTIVE',
      outcome: 'PENDING',
      area: customer.area || customer.location || '',
      deviceSessionId: deviceSessionId || ''
    });

    // 7. Audit Log
    if (TaskAuditLog) {
      await TaskAuditLog.create({
        logId: `LOG-${Date.now()}-${uuidv4().substring(0, 6)}`,
        action: 'LOCK_ACQUIRED',
        agentId,
        agentName,
        agentPhone,
        customerId: customer.customerId,
        sessionId,
        startTime: new Date(),
        details: { deviceSessionId }
      }).catch((e) => console.warn('[AuditLog] Warning:', e.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Recovery lock acquired successfully.',
      customer: updatedCustomer,
      session: newSession
    });
  } catch (error) {
    console.error('startTaskRecovery error:', error);
    return res.status(500).json({ success: false, message: 'Failed to start recovery for customer.' });
  }
};

/**
 * POST /api/v1/tasks/:customerId/complete
 * Task-level End Recovery: moves customer from Assigned Tasks to Completed Tasks
 */
exports.completeTask = async (req, res) => {
  try {
    const { Customer, Assignment, RecoverySession, CompletedTask, TaskAuditLog } = req.models || {};
    if (!Customer || !RecoverySession || !CompletedTask) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const { customerId } = req.params;
    const agentId = req.agent._id;
    const agentStr = agentId.toString();

    // 1. Customer exists
    const customer = await Customer.findOne({
      $or: [
        { customerId },
        ...(mongoose.Types.ObjectId.isValid(customerId) ? [{ _id: customerId }] : [])
      ]
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    // 2. Validate customer assignment
    const isAssigned = (
      (customer.assignedRecoveryAgentId && customer.assignedRecoveryAgentId.toString() === agentStr) ||
      (Array.isArray(customer.assignedRecoveryAgentIds) && customer.assignedRecoveryAgentIds.some((id) => id && id.toString() === agentStr))
    );

    let assignment = null;
    if (Assignment) {
      assignment = await Assignment.findOne({
        customerId: customer._id,
        $or: [{ agentId }, { staffId: agentStr }]
      });
    }

    if (!isAssigned && !assignment) {
      return res.status(403).json({ success: false, message: 'Customer is not assigned to you.' });
    }

    // Idempotency: Check if already completed
    if (customer.recoveryStatus === 'COMPLETED') {
      const existingTask = await CompletedTask.findOne({ customerRefId: customer.customerId }).sort({ completedAt: -1 });
      return res.status(200).json({
        success: true,
        message: 'Task has already been completed.',
        alreadyCompleted: true,
        completedTask: existingTask
      });
    }

    // Customer must be in RECOVERY_IN_PROGRESS
    if (customer.recoveryStatus !== 'RECOVERY_IN_PROGRESS') {
      return res.status(400).json({
        success: false,
        message: `Customer cannot be completed in status ${customer.recoveryStatus}. A recovery session must be submitted first.`
      });
    }

    // 3. Validate recovery session belongs to customer & agent & has been submitted
    const sessionId = customer.activeRecoverySessionId;
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'No active recovery session associated with this customer.'
      });
    }

    const session = await RecoverySession.findOne({
      sessionId,
      $or: [{ agentId }, { staffId: agentStr }]
    });

    if (!session) {
      return res.status(403).json({
        success: false,
        message: 'Recovery session does not belong to you or does not exist.'
      });
    }

    // Stage 1 check: GPS recovery session must be COMPLETED
    if (session.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'The recovery session has not been submitted yet. Please complete GPS recovery and submit before ending task.'
      });
    }

    // 4. Atomically create CompletedTask record
    const completedAt = new Date();
    const taskId = `TASK-COMP-${Date.now()}-${uuidv4().substring(0, 6)}`;

    let voiceUrl = '';
    if (session.voiceStoragePath) {
      try {
        voiceUrl = await getSignedUrl(VOICE_BUCKET, session.voiceStoragePath, 7 * 24 * 3600);
      } catch (_) {}
    }

    const dt = formatDateTime(completedAt);

    const completedTask = await CompletedTask.create({
      taskId,
      customerId: customer._id,
      customerRefId: customer.customerId,
      customerName: customer.customerName || customer.name,
      phoneNumber: customer.phoneNumber || customer.phone,
      fullAddress: customer.fullAddress || customer.address,
      city: customer.city || '',
      location: customer.location || customer.area || '',
      area: customer.area || customer.location || '',
      agentId,
      agentName: req.agent.name || 'Recovery Agent',
      agentPhone: req.agent.phone || '',
      sessionId: session.sessionId,
      recoverySessionId: session._id,
      completedAt,
      completionDate: dt.date,
      completionTime: dt.time,
      distanceMeters: session.distanceMeters || 0,
      durationSeconds: session.durationSeconds || 0,
      voiceNoteUrl: voiceUrl,
      voiceStoragePath: session.voiceStoragePath || '',
      startSpeedometerEvidenceId: session.startSpeedometerEvidenceId || '',
      endSpeedometerEvidenceId: session.endSpeedometerEvidenceId || '',
      outcome: session.outcome || session.nlpCategory || 'COMPLETED',
      visitNotes: session.visitRemarks || session.visitNotes || session.remarks || ''
    });

    // 5. Update Customer recoveryStatus to COMPLETED and release lock
    const finalCustomer = await Customer.findOneAndUpdate(
      { _id: customer._id },
      {
        $set: {
          recoveryStatus: 'COMPLETED',
          completedAt,
          completedByAgentId: agentId,
          completedSessionId: session.sessionId,
          activeRecoverySessionId: null,
          activeRecoveryAgentId: null,
          activeAgentName: '',
          activeAgentPhone: '',
          lockedAt: null
        }
      },
      { new: true }
    );

    if (assignment) {
      await Assignment.updateOne(
        { _id: assignment._id },
        { $set: { recoveryStatus: 'COMPLETED', lastVisitDate: completedAt } }
      ).catch(() => {});
    }

    // 6. Audit Log
    if (TaskAuditLog) {
      await TaskAuditLog.create({
        logId: `LOG-${Date.now()}-${uuidv4().substring(0, 6)}`,
        action: 'LOCK_RELEASED_COMPLETED',
        agentId,
        agentName: req.agent.name,
        agentPhone: req.agent.phone,
        customerId: customer.customerId,
        sessionId: session.sessionId,
        startTime: session.startTime,
        submissionTime: session.endTime,
        completionTime: completedAt,
        releaseTime: completedAt,
        releaseReason: 'Task completed successfully by recovery agent',
        details: { taskId, distanceMeters: session.distanceMeters, durationSeconds: session.durationSeconds }
      }).catch((e) => console.warn('[AuditLog] Warning:', e.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Task completed successfully. Customer moved to Completed Tasks.',
      completedTask,
      customer: finalCustomer
    });
  } catch (error) {
    console.error('completeTask error:', error);
    return res.status(500).json({ success: false, message: 'Failed to complete task.' });
  }
};

/**
 * POST /api/v1/tasks/:customerId/cancel
 * Explicit cancellation of an active recovery lock
 */
exports.cancelTaskRecovery = async (req, res) => {
  try {
    const { Customer, RecoverySession, TaskAuditLog } = req.models || {};
    if (!Customer || !RecoverySession) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const { customerId } = req.params;
    const agentId = req.agent._id;
    const agentStr = agentId.toString();

    const customer = await Customer.findOne({
      $or: [
        { customerId },
        ...(mongoose.Types.ObjectId.isValid(customerId) ? [{ _id: customerId }] : [])
      ]
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    if (customer.recoveryStatus !== 'RECOVERY_IN_PROGRESS') {
      return res.status(400).json({ success: false, message: 'Customer is not in recovery.' });
    }

    if (customer.activeRecoveryAgentId && customer.activeRecoveryAgentId.toString() !== agentStr) {
      return res.status(403).json({ success: false, message: 'You are not authorized to cancel another agent\'s session.' });
    }

    const sessionId = customer.activeRecoverySessionId;
    if (sessionId) {
      await RecoverySession.updateOne(
        { sessionId },
        { $set: { status: 'CANCELLED', endTime: new Date() } }
      ).catch(() => {});
    }

    const updatedCustomer = await Customer.findOneAndUpdate(
      { _id: customer._id },
      {
        $set: {
          recoveryStatus: 'ASSIGNED',
          activeRecoverySessionId: null,
          activeRecoveryAgentId: null,
          activeAgentName: '',
          activeAgentPhone: '',
          lockedAt: null
        }
      },
      { new: true }
    );

    if (TaskAuditLog) {
      await TaskAuditLog.create({
        logId: `LOG-${Date.now()}-${uuidv4().substring(0, 6)}`,
        action: 'LOCK_RELEASED_CANCELLED',
        agentId,
        agentName: req.agent.name,
        agentPhone: req.agent.phone,
        customerId: customer.customerId,
        sessionId,
        releaseTime: new Date(),
        releaseReason: 'Agent cancelled recovery session'
      }).catch((e) => console.warn('[AuditLog] Warning:', e.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Recovery session cancelled. Customer lock released.',
      customer: updatedCustomer
    });
  } catch (error) {
    console.error('cancelTaskRecovery error:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel recovery session.' });
  }
};

/**
 * GET /api/v1/tasks/active
 * Returns current active task & session for this agent (for app restart recovery)
 */
exports.getActiveTask = async (req, res) => {
  try {
    const { Customer, RecoverySession } = req.models || {};
    if (!Customer || !RecoverySession) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const agentId = req.agent._id;
    const agentStr = agentId.toString();

    // Check for active session
    const activeSession = await RecoverySession.findOne({
      $or: [{ agentId }, { staffId: agentStr }],
      status: 'ACTIVE'
    }).lean();

    if (!activeSession) {
      return res.status(200).json({ success: true, active: false, activeTask: null, session: null });
    }

    // Look up associated customer
    let customer = null;
    if (activeSession.customerId) {
      customer = await Customer.findOne({ _id: activeSession.customerId }).lean();
    }
    if (!customer && activeSession.customerRefId) {
      customer = await Customer.findOne({ customerId: activeSession.customerRefId }).lean();
    }

    return res.status(200).json({
      success: true,
      active: true,
      activeTask: customer,
      session: activeSession
    });
  } catch (error) {
    console.error('getActiveTask error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve active task.' });
  }
};

/**
 * GET /api/v1/tasks/completed/:taskId
 * Returns detail of a completed task
 */
exports.getCompletedTaskDetail = async (req, res) => {
  try {
    const { CompletedTask, RecoverySession, Evidence, TrackingPoint } = req.models || {};
    if (!CompletedTask) {
      return res.status(503).json({ success: false, message: 'Database models not initialized.' });
    }

    const { taskId } = req.params;
    const completedTask = await CompletedTask.findOne({
      $or: [
        { taskId },
        ...(mongoose.Types.ObjectId.isValid(taskId) ? [{ _id: taskId }] : [])
      ]
    }).lean();

    if (!completedTask) {
      return res.status(404).json({ success: false, message: 'Completed task record not found.' });
    }

    // Ensure signed voice URL
    let voiceUrl = completedTask.voiceNoteUrl || '';
    if (!voiceUrl && completedTask.voiceStoragePath) {
      try {
        voiceUrl = await getSignedUrl(VOICE_BUCKET, completedTask.voiceStoragePath, 3600);
      } catch (_) {}
    }

    let session = null;
    let points = [];
    if (completedTask.sessionId && RecoverySession) {
      session = await RecoverySession.findOne({ sessionId: completedTask.sessionId }).lean();
      if (TrackingPoint) {
        points = await TrackingPoint.find({ sessionId: completedTask.sessionId }).select('latitude longitude timestamp').sort({ timestamp: 1 }).lean();
      }
    }

    return res.status(200).json({
      success: true,
      completedTask: {
        ...completedTask,
        voiceNoteUrl: voiceUrl,
        session,
        pointsCount: points.length,
        routePoints: points
      }
    });
  } catch (error) {
    console.error('getCompletedTaskDetail error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve task detail.' });
  }
};
