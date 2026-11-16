const mongoose = require('mongoose');

const trackingPointSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    pointId: { type: String, sparse: true, index: true },
    agentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', index: true },
    staffId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', index: true }, // backward-compatibility
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, default: 0 },
    altitude: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

trackingPointSchema.index(
  { sessionId: 1, pointId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { pointId: { $type: 'string', $gt: '' } }
  }
);

trackingPointSchema.pre('save', function (next) {
  if (this.agentId && !this.staffId) {
    this.staffId = this.agentId;
  } else if (this.staffId && !this.agentId) {
    this.agentId = this.staffId;
  }
  next();
});

const TrackingPoint = mongoose.model('TrackingPoint', trackingPointSchema);
TrackingPoint.schema = trackingPointSchema;
module.exports = TrackingPoint;
