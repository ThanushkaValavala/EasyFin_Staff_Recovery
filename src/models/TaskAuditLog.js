const mongoose = require('mongoose');

const taskAuditLogSchema = new mongoose.Schema(
  {
    logId: { type: String, required: true, unique: true, index: true },
    action: {
      type: String,
      enum: ['LOCK_ACQUIRED', 'LOCK_RELEASED_COMPLETED', 'LOCK_RELEASED_CANCELLED', 'STALE_LOCK_RECOVERED'],
      required: true,
      index: true
    },
    agentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', required: true, index: true },
    agentName: { type: String, default: '' },
    agentPhone: { type: String, default: '' },
    customerId: { type: String, required: true, index: true },
    sessionId: { type: String, default: null, index: true },

    startTime: { type: Date, default: null },
    submissionTime: { type: Date, default: null },
    completionTime: { type: Date, default: null },
    releaseTime: { type: Date, default: null },
    releaseReason: { type: String, default: '' },

    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true }
  },
  {
    timestamps: true,
    collection: 'task_audit_logs'
  }
);

const TaskAuditLog = mongoose.model('TaskAuditLog', taskAuditLogSchema);
TaskAuditLog.schema = taskAuditLogSchema;
module.exports = TaskAuditLog;
