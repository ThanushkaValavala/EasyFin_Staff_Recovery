const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema(
  {
    loanId: { type: String, required: [true, 'Loan number is required'], unique: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: [true, 'Customer reference is required'] },
    loanDate: { type: Date, default: Date.now },
    loanType: { type: String, default: 'Personal Loan', trim: true },
    pendingAmount: { type: Number, required: [true, 'Pending amount is required'] },
    penalty: { type: Number, default: 0 },
    // Backward-compatibility aliases
    outstandingAmount: { type: Number, default: function() { return this.pendingAmount; } },
    penaltyAmount: { type: Number, default: function() { return this.penalty; } },
    totalAmount: { type: Number, default: function() { return this.pendingAmount; } },
    overdueAmount: { type: Number, default: function() { return this.pendingAmount; } },
    emiAmount: { type: Number, default: 0 },
    overdueDays: { type: Number, default: 0 },
    status: { type: String, enum: ['ACTIVE', 'OVERDUE', 'DEFAULTED', 'CLOSED'], default: 'OVERDUE' }
  },
  {
    timestamps: true,
    collection: 'loans'
  }
);

loanSchema.pre('save', function (next) {
  if (this.pendingAmount !== undefined) {
    this.outstandingAmount = this.pendingAmount;
  }
  if (this.penalty !== undefined) {
    this.penaltyAmount = this.penalty;
  }
  next();
});

const Loan = mongoose.model('Loan', loanSchema);
Loan.schema = loanSchema;
module.exports = Loan;
