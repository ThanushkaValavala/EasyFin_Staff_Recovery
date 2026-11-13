const mongoose = require('mongoose');

const stopEventSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    stopIndex: { type: Number, default: 1 },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationSeconds: { type: Number, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    placeName: { type: String, required: true },
    address: { type: String, default: '' },
    dwellType: { type: String, enum: ['CUSTOMER_VISIT', 'INTERMEDIATE_STOP', 'TRANSIT_HALT'], default: 'INTERMEDIATE_STOP' }
  },
  { timestamps: true }
);

const StopEvent = mongoose.model('StopEvent', stopEventSchema);
StopEvent.schema = stopEventSchema;
module.exports = StopEvent;
