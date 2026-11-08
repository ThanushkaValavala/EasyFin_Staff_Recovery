const mongoose = require('mongoose');

const recoverySessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    agentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', required: true, index: true },
    staffId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', index: true }, // backward-compatibility
    assignmentId: { type: mongoose.Schema.Types.Mixed, ref: 'Assignment', index: true },
    customerId: { type: mongoose.Schema.Types.Mixed, ref: 'Customer' },
    loanId: { type: mongoose.Schema.Types.Mixed, ref: 'Loan' },
    startTime: { type: Date, required: true, default: Date.now },
    endTime: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    distanceMeters: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'],
      default: 'ACTIVE',
      index: true
    },
    outcome: {
      type: String,
      enum: [
        'PENDING',
        'CUSTOMER_CONTACTED',
        'PAYMENT_PROMISED',
        'PAYMENT_COLLECTED',
        'CUSTOMER_UNAVAILABLE',
        'FOLLOW_UP_REQUIRED'
      ],
      default: 'PENDING'
    },
    paymentAmount: { type: Number, default: 0 },
    promiseDate: { type: Date, default: null },
    visitNotes: { type: String, default: '' },
    isReportSubmitted: { type: Boolean, default: false },
    area: { type: String, default: '' },
    cases: [{
      _id: false,
      assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' },
      customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
      loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan' }
    }],
    startSpeedometerEvidenceId: { type: String, default: '' },
    endSpeedometerEvidenceId: { type: String, default: '' },
    remarks: { type: String, default: '' },
    rawRemarks: { type: String, default: '' },
    nlpSummary: { type: String, default: '' },
    nlpCategory: {
      type: String,
      enum: ['PAID', 'PROMISED', 'UNAVAILABLE', 'REFUSED', 'GENERAL', ''],
      default: '',
    },
    vehicleType: { type: String, default: '' },
    vehicleNumber: { type: String, default: '' },
    deviceSessionId: { type: String, default: '', index: true },
    startLocation: { latitude: { type: Number }, longitude: { type: Number } },
    endLocation: { latitude: { type: Number }, longitude: { type: Number } }
  },
  { timestamps: true }
);

recoverySessionSchema.pre('save', function (next) {
  // Sync staffId from agentId or vice-versa for full backward compatibility
  if (this.agentId && !this.staffId) {
    this.staffId = this.agentId;
  } else if (this.staffId && !this.agentId) {
    this.agentId = this.staffId;
  }
  next();
});

module.exports = mongoose.model('RecoverySession', recoverySessionSchema);
