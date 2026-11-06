const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    alternatePhone: { type: String, default: '' },
    aadhaar: { type: String, default: '', match: [/^(\d{12})?$/, 'Aadhaar must be 12 digits'] },
    dob: { type: Date, default: null },
    address: { type: String, required: true },
    landmark: { type: String, default: '' },
    city: { type: String, default: '' },
    area: { type: String, default: '', index: true },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', customerSchema);