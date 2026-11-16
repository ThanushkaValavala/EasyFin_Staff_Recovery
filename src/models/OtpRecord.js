const mongoose = require('mongoose');

/**
 * OtpRecord — Persistent OTP storage with automatic expiry via MongoDB TTL index.
 * Includes attempts count and resend cooldown support.
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
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index: MongoDB will automatically delete documents where expiresAt < current time
otpRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OtpRecord = mongoose.model('OtpRecord', otpRecordSchema);
OtpRecord.schema = otpRecordSchema;
module.exports = OtpRecord;
