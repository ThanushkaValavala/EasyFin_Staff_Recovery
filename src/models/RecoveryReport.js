const mongoose = require('mongoose');

const recoveryReportSchema = new mongoose.Schema(
  {
    reportId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true },
    
    // Snapshot fields at report submission time
    staffName: { type: String, required: true },
    staffEmployeeId: { type: String, required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerAddress: { type: String, required: true },
    loanNumber: { type: String, required: true },
    loanOutstandingAmount: { type: Number, required: true },
    loanOverdueAmount: { type: Number, required: true },
    
    // Session metrics
    recoveryDate: { type: Date, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationSeconds: { type: Number, required: true },
    distanceMeters: { type: Number, required: true },
    
    // Visit details
    recoveryOutcome: {
      type: String,
      enum: [
        'CUSTOMER_CONTACTED',
        'PAYMENT_PROMISED',
        'PAYMENT_COLLECTED',
        'CUSTOMER_UNAVAILABLE',
        'FOLLOW_UP_REQUIRED'
      ],
      required: true
    },
    paymentAmount: { type: Number, default: 0 },
    promiseDate: { type: Date, default: null },
    visitNotes: { type: String, default: '' },

    // Vehicle and route endpoints
    vehicleType: { type: String, default: '' },
    vehicleNumber: { type: String, default: '' },
    startLocation: { latitude: { type: Number }, longitude: { type: Number } },
    endLocation: { latitude: { type: Number }, longitude: { type: Number } },
    
    // Places visited snapshot
    placesVisited: [
      {
        stopIndex: Number,
        placeName: String,
        address: String,
        latitude: Number,
        longitude: Number,
        startTime: Date,
        endTime: Date,
        durationSeconds: Number
      }
    ],
    
    // Evidence photos
    evidence: [
      {
        evidenceId: String,
        fileName: String,
        filePath: String,
        caption: String,
        capturedAt: Date
      }
    ],
    
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const RecoveryReport = mongoose.model('RecoveryReport', recoveryReportSchema);
RecoveryReport.schema = recoveryReportSchema;
module.exports = RecoveryReport;
