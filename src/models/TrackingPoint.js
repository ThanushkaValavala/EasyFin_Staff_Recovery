const mongoose = require('mongoose');

const trackingPointSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    agentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff' },
    staffId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff' }, // backward-compatibility
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, default: 0 },
    altitude: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

trackingPointSchema.pre('save', function (next) {
  if (this.agentId && !this.staffId) {
    this.staffId = this.agentId;
  } else if (this.staffId && !this.agentId) {
    this.agentId = this.staffId;
  }
  next();
});

module.exports = mongoose.model('TrackingPoint', trackingPointSchema);
