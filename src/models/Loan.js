const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema(
  {
    loanId: { type: String, required: true, unique: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    loanType: { type: String, default: 'Personal Loan' },
    loanDate: { type: Date, default: Date.now },
    totalAmount: { type: Number, required: true },
    outstandingAmount: { type: Number, required: true }, // shown in the app as "Pending amount"
    penaltyAmount: { type: Number, default: 0 },
    overdueAmount: { type: Number, default: 0 },
    emiAmount: { type: Number, default: 0 },
    overdueDays: { type: Number, default: 0 },
    status: { type: String, enum: ['ACTIVE', 'OVERDUE', 'DEFAULTED', 'CLOSED'], default: 'OVERDUE' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Loan', loanSchema);