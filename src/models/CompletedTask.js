const mongoose = require('mongoose');

const completedTaskSchema = new mongoose.Schema(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    customerId: { type: mongoose.Schema.Types.Mixed, ref: 'Customer', required: true, index: true },
    customerRefId: { type: String, required: true, index: true },
    customerName: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    fullAddress: { type: String, required: true, trim: true },
    city: { type: String, default: '', trim: true },
    location: { type: String, default: '', trim: true, index: true },
    area: { type: String, default: '', trim: true, index: true },

    agentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', required: true, index: true },
    agentName: { type: String, required: true, trim: true },
    agentPhone: { type: String, required: true, trim: true },

    sessionId: { type: String, required: true, index: true },
    recoverySessionId: { type: mongoose.Schema.Types.Mixed, ref: 'RecoverySession' },

    completedAt: { type: Date, default: Date.now, index: true },
    completionDate: { type: String, default: '' },
    completionTime: { type: String, default: '' },

    distanceMeters: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },

    voiceNoteUrl: { type: String, default: '' },
    voiceStoragePath: { type: String, default: '' },

    startSpeedometerEvidenceId: { type: String, default: '' },
    endSpeedometerEvidenceId: { type: String, default: '' },
    startSpeedometerUrl: { type: String, default: '' },
    endSpeedometerUrl: { type: String, default: '' },

    outcome: { type: String, default: 'COMPLETED' },
    visitNotes: { type: String, default: '' }
  },
  {
    timestamps: true,
    collection: 'completed_tasks'
  }
);

completedTaskSchema.pre('save', function (next) {
  if (this.completedAt) {
    const d = new Date(this.completedAt);
    if (!this.completionDate) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      this.completionDate = `${year}-${month}-${day}`;
    }
    if (!this.completionTime) {
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      this.completionTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    }
  }
  next();
});

const CompletedTask = mongoose.model('CompletedTask', completedTaskSchema);
CompletedTask.schema = completedTaskSchema;
module.exports = CompletedTask;
