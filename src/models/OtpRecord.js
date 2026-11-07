const mongoose = require('mongoose');

/**
 * OtpRecord — Persistent OTP storage with automatic expiry via MongoDB TTL index.
 * Replaces the in-memory Map to survive server restarts/cold-starts.
 */
const otpRecordSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // No field-level index here — the TTL index is declared below
    },
  },
  {
    timestamps: true,
  }
);

// TTL index: MongoDB will automatically delete documents where expiresAt < current time
otpRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpRecord', otpRecordSchema);

