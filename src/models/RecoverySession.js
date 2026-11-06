const mongoose = require('mongoose');

const recoverySessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
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
    vehicleType: { type: String, default: '' },
    vehicleNumber: { type: String, default: '' },
    startLocation: { latitude: { type: Number }, longitude: { type: Number } },
    endLocation: { latitude: { type: Number }, longitude: { type: Number } }
  },
  { timestamps: true }
);

module.exports = mongoose.model('RecoverySession', recoverySessionSchema);
