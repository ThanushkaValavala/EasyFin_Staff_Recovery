const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    assignmentId: { type: String, required: true, unique: true, index: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', index: true }, // backward-compatibility
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    assignedDate: { type: Date, default: Date.now },
    priority: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'HIGH' },
    recoveryStatus: {
      type: String,
      enum: [
        'PENDING',
        'IN_PROGRESS',
        'CUSTOMER_CONTACTED',
        'PAYMENT_PROMISED',
        'PAYMENT_COLLECTED',
        'CUSTOMER_UNAVAILABLE',
        'FOLLOW_UP_REQUIRED',
        'COMPLETED'
      ],
      default: 'PENDING'
    },
    notes: { type: String, default: '' },
    lastVisitDate: { type: Date, default: null }
  },
  { timestamps: true }
);

assignmentSchema.pre('save', function (next) {
  if (this.agentId && !this.staffId) {
    this.staffId = this.agentId;
  } else if (this.staffId && !this.agentId) {
    this.agentId = this.staffId;
  }
  next();
});

module.exports = mongoose.model('Assignment', assignmentSchema);
