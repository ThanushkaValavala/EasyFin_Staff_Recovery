const { v4: uuidv4 } = require('uuid');





const memoryStore = require('../services/store');
const { getIsConnected } = require('../config/db');
const { getDistanceInMeters } = require('../services/stopDetectionService');
const rules = require('../services/recoveryRules');

exports.startSession = async (req, res) => {
  const { RecoverySession, TrackingPoint, StopEvent, Assignment, Evidence } = req.models || {};
  try {
    const staffId = req.staff._id.toString();
    const {
      assignmentId,
      customerId,
      loanId,
      initialLocation,
      vehicleType,
      vehicleNumber
    } = req.body;

    if (!assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment ID is required to start a recovery session.'
      });
    }

    const vehicleCheck = rules.validateVehicle(vehicleType, vehicleNumber);
    if (vehicleCheck.error) {
      return res.status(400).json({
        success: false,
        message: vehicleCheck.error
      });
    }

    if (req.models || getIsConnected()) {
      let activeSession = await RecoverySession.findOne({
        staffId,
        status: 'ACTIVE'
      });

      if (activeSession) {
        return res.status(200).json({
          success: true,
          isExisting: true,
          message: 'Resumed existing active recovery session.',
          session: activeSession
        });
      }

      const sessionId = `SESS-${Date.now()}-${uuidv4().substring(0, 8)}`;
      const newSession = new RecoverySession({
        sessionId,
        staffId,
        assignmentId,
        customerId,
        loanId,
        startTime: new Date(),
        status: 'ACTIVE',
        outcome: 'PENDING',
        vehicleType: vehicleCheck.vehicleType,
        vehicleNumber: vehicleCheck.vehicleNumber,
        startLocation: rules.pickLocation(initialLocation)
      });

      await newSession.save();

      await Assignment.findByIdAndUpdate(assignmentId, {
        recoveryStatus: 'IN_PROGRESS',
        lastVisitDate: new Date()
      });

      if (initialLocation && initialLocation.latitude) {
        await TrackingPoint.create({
          sessionId,
          staffId,
          latitude: initialLocation.latitude,
          longitude: initialLocation.longitude,
          accuracy: initialLocation.accuracy || 0,
          timestamp: new Date()
        });
      }

      return res.status(201).json({
        success: true,
        isExisting: false,
        message: 'Recovery session started successfully.',
        session: newSession
      });
    } else {
      await memoryStore.initDefaults();

      let activeSession = memoryStore.sessions.find(
        s => s.staffId === staffId && s.status === 'ACTIVE'
      );

      if (activeSession) {
        return res.status(200).json({
          success: true,
          isExisting: true,
          message: 'Resumed existing active recovery session.',
          session: activeSession
        });
      }

      const sessionId = `SESS-${Date.now()}-${uuidv4().substring(0, 8)}`;
      const newSession = {
        _id: `sess_${Date.now()}`,
        sessionId,
        staffId,
        assignmentId,
        customerId,
        loanId,
        startTime: new Date().toISOString(),
        endTime: null,
        durationSeconds: 0,
        distanceMeters: 0,
        status: 'ACTIVE',
        outcome: 'PENDING',
        paymentAmount: 0,
        visitNotes: '',
        isReportSubmitted: false,
        vehicleType: vehicleCheck.vehicleType,
        vehicleNumber: vehicleCheck.vehicleNumber,
        startLocation: rules.pickLocation(initialLocation)
      };

      memoryStore.sessions.push(newSession);

      const asgn = memoryStore.assignments.find(
        a => a._id === assignmentId || a.assignmentId === assignmentId
      );

      if (asgn) {
        asgn.recoveryStatus = 'IN_PROGRESS';
        asgn.lastVisitDate = new Date().toISOString();
      }

      if (initialLocation && initialLocation.latitude) {
        memoryStore.trackingPoints.push({
          sessionId,
          staffId,
          latitude: initialLocation.latitude,
          longitude: initialLocation.longitude,
          accuracy: initialLocation.accuracy || 0,
          timestamp: new Date().toISOString()
        });
      }

      return res.status(201).json({
        success: true,
        isExisting: false,
        message: 'Recovery session started successfully.',
        session: newSession
      });
    }
  } catch (error) {
    console.error('Error starting session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start recovery session.'
    });
  }
};

exports.getActiveSession = async (req, res) => {
  const { RecoverySession, TrackingPoint, StopEvent, Assignment, Evidence } = req.models || {};
  try {
    const staffId = req.staff._id.toString();

    if (req.models || getIsConnected()) {
      const session = await RecoverySession.findOne({
        staffId,
        status: 'ACTIVE'
      });

      if (!session) {
        return res.status(200).json({
          success: true,
          active: false,
          session: null
        });
      }

      const points = await TrackingPoint.find({
        sessionId: session.sessionId
      }).sort({ timestamp: 1 });

      const stops = await StopEvent.find({
        sessionId: session.sessionId
      }).sort({ startTime: 1 });

      const evidences = await Evidence.find({
        sessionId: session.sessionId
      }).sort({ capturedAt: 1 });

      return res.status(200).json({
        success: true,
        active: true,
        session,
        pointsCount: points.length,
        stops,
        evidences
      });
    } else {
      await memoryStore.initDefaults();

      const session = memoryStore.sessions.find(
        s => s.staffId === staffId && s.status === 'ACTIVE'
      );

      if (!session) {
        return res.status(200).json({
          success: true,
          active: false,
          session: null
        });
      }

      const stops = memoryStore.stops.filter(
        st => st.sessionId === session.sessionId
      );

      const evidences = memoryStore.evidences.filter(
        e => e.sessionId === session.sessionId
      );

      const points = memoryStore.trackingPoints.filter(
        p => p.sessionId === session.sessionId
      );

      return res.status(200).json({
        success: true,
        active: true,
        session,
        pointsCount: points.length,
        stops,
        evidences
      });
    }
  } catch (error) {
    console.error('Error retrieving active session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve active session.'
    });
  }
};

exports.addTrackingPoints = async (req, res) => {
  const { RecoverySession, TrackingPoint, StopEvent, Assignment, Evidence } = req.models || {};
  try {
    const { sessionId } = req.params;
    const { points, incrementalDistanceMeters, batchId } = req.body;
    const agentId = (req.agent && req.agent._id) || req.staff._id;
    const staffId = agentId.toString();

    if (!points || !Array.isArray(points) || points.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Points array is required.'
      });
    }

    if (req.models || getIsConnected()) {
      const session = await RecoverySession.findOne({
        sessionId,
        $or: [{ agentId }, { staffId }]
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found or access denied.'
        });
      }

      // If batch was already processed, respond idempotently without adding distance again
      if (batchId && session.processedBatchIds && session.processedBatchIds.includes(batchId)) {
        return res.status(200).json({
          success: true,
          message: 'Batch already processed.',
          batchId
        });
      }

      const docs = points.map(p => ({
        sessionId,
        agentId,
        staffId,
        pointId: p.pointId || `${sessionId}_${new Date(p.timestamp || Date.now()).getTime()}_${Number(p.latitude).toFixed(6)}_${Number(p.longitude).toFixed(6)}`,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        accuracy: Number(p.accuracy) || 0,
        altitude: Number(p.altitude) || 0,
        speed: Number(p.speed) || 0,
        timestamp: p.timestamp ? new Date(p.timestamp) : new Date()
      }));

      try {
        await TrackingPoint.insertMany(docs, { ordered: false });
      } catch (insertErr) {
        // Ignore duplicate pointId errors (code 11000)
        if (insertErr.code !== 11000 && !insertErr.writeErrors?.every(e => e.code === 11000)) {
          throw insertErr;
        }
      }

      const updateOp = {};
      if (batchId) {
        updateOp.$addToSet = { processedBatchIds: batchId };
      }
      if (incrementalDistanceMeters && Number(incrementalDistanceMeters) > 0) {
        updateOp.$inc = { distanceMeters: Number(incrementalDistanceMeters) };
      }

      if (Object.keys(updateOp).length > 0) {
        await RecoverySession.updateOne(
          { sessionId, $or: [{ agentId }, { staffId }] },
          updateOp
        );
      }

      return res.status(200).json({
        success: true,
        message: `${points.length} tracking points recorded.`
      });
    } else {
      await memoryStore.initDefaults();

      const session = memoryStore.sessions.find(
        s => s.sessionId === sessionId && s.staffId === staffId
      );

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found.'
        });
      }

      points.forEach(p => {
        memoryStore.trackingPoints.push({
          sessionId,
          staffId,
          pointId: p.pointId,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracy: p.accuracy || 0,
          altitude: p.altitude || 0,
          speed: p.speed || 0,
          timestamp: p.timestamp || new Date().toISOString()
        });
      });

      if (incrementalDistanceMeters > 0) {
        session.distanceMeters =
          (session.distanceMeters || 0) + incrementalDistanceMeters;
      }

      return res.status(200).json({
        success: true,
        message: `${points.length} tracking points recorded.`
      });
    }
  } catch (error) {
    console.error('Error recording tracking points:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record tracking points.'
    });
  }
};

exports.recordStop = async (req, res) => {
  const { RecoverySession, TrackingPoint, StopEvent, Assignment, Evidence } = req.models || {};
  try {
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();

    const {
      stopIndex,
      startTime,
      endTime,
      durationSeconds,
      latitude,
      longitude,
      placeName,
      address,
      dwellType
    } = req.body;

    if (!placeName || latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        message: 'Readable place name, latitude, and longitude are required.'
      });
    }

    if (req.models || getIsConnected()) {
      const session = await RecoverySession.findOne({ sessionId, staffId });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found.'
        });
      }

      const stop = await StopEvent.create({
        sessionId,
        staffId,
        stopIndex: stopIndex || 1,
        startTime: startTime ? new Date(startTime) : new Date(),
        endTime: endTime ? new Date(endTime) : new Date(),
        durationSeconds: durationSeconds || 0,
        latitude,
        longitude,
        placeName,
        address: address || '',
        dwellType: dwellType || 'INTERMEDIATE_STOP'
      });

      return res.status(201).json({
        success: true,
        message: 'Detected stop saved successfully.',
        stop
      });
    } else {
      await memoryStore.initDefaults();

      const session = memoryStore.sessions.find(
        s => s.sessionId === sessionId && s.staffId === staffId
      );

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found.'
        });
      }

      const stop = {
        _id: `stop_${Date.now()}`,
        sessionId,
        staffId,
        stopIndex: stopIndex || memoryStore.stops.filter(
          s => s.sessionId === sessionId
        ).length + 1,
        startTime: startTime || new Date().toISOString(),
        endTime: endTime || new Date().toISOString(),
        durationSeconds: durationSeconds || 0,
        latitude,
        longitude,
        placeName,
        address: address || '',
        dwellType: dwellType || 'INTERMEDIATE_STOP'
      };

      memoryStore.stops.push(stop);

      return res.status(201).json({
        success: true,
        message: 'Detected stop saved successfully.',
        stop
      });
    }
  } catch (error) {
    console.error('Error recording stop:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to record stop.'
    });
  }
};

exports.updateSessionOutcome = async (req, res) => {
  const { RecoverySession, TrackingPoint, StopEvent, Assignment, Evidence } = req.models || {};
  try {
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();

    const { outcome, visitNotes, paymentAmount, promiseDate } = req.body;

    if (req.models || getIsConnected()) {
      const update = {};

      if (outcome !== undefined) update.outcome = outcome;
      if (visitNotes !== undefined) update.visitNotes = visitNotes;
      if (paymentAmount !== undefined) {
        update.paymentAmount = Number(paymentAmount);
      }
      if (promiseDate !== undefined) {
        update.promiseDate = promiseDate ? new Date(promiseDate) : null;
      }

      const session = await RecoverySession.findOneAndUpdate(
        { sessionId, staffId },
        { $set: update },
        { new: true }
      );

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found.'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Session outcome updated.',
        session
      });
    } else {
      await memoryStore.initDefaults();

      const session = memoryStore.sessions.find(
        s => s.sessionId === sessionId && s.staffId === staffId
      );

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found.'
        });
      }

      if (outcome !== undefined) session.outcome = outcome;
      if (visitNotes !== undefined) session.visitNotes = visitNotes;
      if (paymentAmount !== undefined) {
        session.paymentAmount = Number(paymentAmount);
      }
      if (promiseDate !== undefined) session.promiseDate = promiseDate;

      return res.status(200).json({
        success: true,
        message: 'Session outcome updated.',
        session
      });
    }
  } catch (error) {
    console.error('Error updating session outcome:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update session outcome.'
    });
  }
};

exports.endSession = async (req, res) => {
  const { RecoverySession, TrackingPoint, StopEvent, Assignment, Evidence } = req.models || {};
  try {
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();

    const {
      outcome,
      visitNotes,
      paymentAmount,
      promiseDate,
      distanceMeters,
      durationSeconds,
      endLocation
    } = req.body;

    const completionError = await rules.validateCompletion({
      sessionId,
      staffId,
      paymentAmount,
      visitNotes,
      models: req.models
    });

    if (completionError) {
      return res.status(400).json({
        success: false,
        message: completionError
      });
    }

    const endTime = new Date();

    if (req.models || getIsConnected()) {
      const session = await RecoverySession.findOne({ sessionId, staffId });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found.'
        });
      }

      const calculatedDuration = durationSeconds ||
        Math.round(
          (endTime.getTime() - new Date(session.startTime).getTime()) / 1000
        );

      session.endTime = endTime;
      session.status = 'COMPLETED';

      const finalLocation = rules.pickLocation(endLocation);
      if (finalLocation) session.endLocation = finalLocation;
      session.durationSeconds = calculatedDuration;

      if (distanceMeters !== undefined) session.distanceMeters = distanceMeters;
      if (outcome) session.outcome = outcome;
      if (visitNotes !== undefined) session.visitNotes = visitNotes;
      if (paymentAmount !== undefined) {
        session.paymentAmount = Number(paymentAmount);
      }
      if (promiseDate) session.promiseDate = new Date(promiseDate);

      await session.save();

      await Assignment.findByIdAndUpdate(session.assignmentId, {
        recoveryStatus: outcome || 'COMPLETED',
        notes: visitNotes || '',
        lastVisitDate: endTime
      });

      return res.status(200).json({
        success: true,
        message: 'Recovery session completed successfully.',
        session
      });
    } else {
      await memoryStore.initDefaults();

      const session = memoryStore.sessions.find(
        s => s.sessionId === sessionId && s.staffId === staffId
      );

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found.'
        });
      }

      const calculatedDuration = durationSeconds ||
        Math.round(
          (endTime.getTime() - new Date(session.startTime).getTime()) / 1000
        );

      session.endTime = endTime.toISOString();
      session.status = 'COMPLETED';

      const finalLocation = rules.pickLocation(endLocation);
      if (finalLocation) session.endLocation = finalLocation;
      session.durationSeconds = calculatedDuration;

      if (distanceMeters !== undefined) session.distanceMeters = distanceMeters;
      if (outcome) session.outcome = outcome;
      if (visitNotes !== undefined) session.visitNotes = visitNotes;
      if (paymentAmount !== undefined) {
        session.paymentAmount = Number(paymentAmount);
      }
      if (promiseDate) session.promiseDate = promiseDate;

      const asgn = memoryStore.assignments.find(
        a => a._id === session.assignmentId ||
             a.assignmentId === session.assignmentId
      );

      if (asgn) {
        asgn.recoveryStatus = outcome || 'COMPLETED';
        asgn.notes = visitNotes || '';
        asgn.lastVisitDate = endTime.toISOString();
      }

      return res.status(200).json({
        success: true,
        message: 'Recovery session completed successfully.',
        session
      });
    }
  } catch (error) {
    console.error('Error ending session:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to end recovery session.'
    });
  }
};

// GET COMPLETE JOURNEY DETAILS
exports.getJourneyDetails = async (req, res) => {
  const { RecoverySession, TrackingPoint, StopEvent, Assignment, Evidence } = req.models || {};
  try {
    const { sessionId } = req.params;
    const staffId = req.staff._id.toString();

    let session;
    let points;
    let stops;
    let evidences;

    if (req.models || getIsConnected()) {
      session = await RecoverySession.findOne({ sessionId, staffId });

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Recovery session not found.'
        });
      }

      points = await TrackingPoint.find({ sessionId, staffId })
        .sort({ timestamp: 1 });

      stops = await StopEvent.find({ sessionId, staffId })
        .sort({ startTime: 1 });

      evidences = await Evidence.find({ sessionId })
        .sort({ capturedAt: 1 });

    } else {
      await memoryStore.initDefaults();

      session = memoryStore.sessions.find(
        s => s.sessionId === sessionId && s.staffId === staffId
      );

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Recovery session not found.'
        });
      }

      points = memoryStore.trackingPoints
        .filter(p => p.sessionId === sessionId && p.staffId === staffId)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      stops = memoryStore.stops
        .filter(s => s.sessionId === sessionId && s.staffId === staffId)
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

      evidences = memoryStore.evidences
        .filter(e => e.sessionId === sessionId);
    }

    return res.status(200).json({
      success: true,
      message: 'Journey details retrieved successfully.',
      journey: {
        session,
        trackingPoints: points,
        stops,
        evidences,
        summary: {
          totalTrackingPoints: points.length,
          totalStops: stops.length,
          totalEvidence: evidences.length,
          distanceMeters: session.distanceMeters || 0,
          durationSeconds: session.durationSeconds || 0,
          status: session.status,
          outcome: session.outcome
        }
      }
    });

  } catch (error) {
    console.error('Error retrieving journey details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve journey details.'
    });
  }
};