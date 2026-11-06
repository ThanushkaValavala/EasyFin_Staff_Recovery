const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema(
  {
    evidenceId: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    kind: { type: String, enum: ['EVIDENCE', 'START_SPEEDOMETER', 'END_SPEEDOMETER'], default: 'EVIDENCE', index: true },
    fileName: { type: String, required: true },
    originalName: { type: String, default: 'photo.jpg' },
    filePath: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: 'image/jpeg' },
    caption: { type: String, default: 'Recovery Evidence' },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    capturedAt: { type: Date, default: Date.now },
    data: { type: Buffer, select: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Evidence', evidenceSchema);