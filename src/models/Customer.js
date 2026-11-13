const mongoose = require('mongoose');

const maskAadhaar = (val) => {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length >= 4) {
    return `XXXX-XXXX-${digits.slice(-4)}`;
  }
  return val;
};

const customerSchema = new mongoose.Schema(
  {
    customerId: { type: String, default: '', index: true },
    name: { type: String, required: [true, 'Customer name is required'], trim: true },
    aadhaar: { type: String, default: '', trim: true },
    dob: { type: Date, default: null },
    address: { type: String, required: [true, 'Address is required'], trim: true },
    area: { type: String, required: [true, 'Area is required'], trim: true, index: true },
    landmark: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    alternatePhone: { type: String, default: '', trim: true },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 }
  },
  {
    timestamps: true,
    collection: 'customers'
  }
);

customerSchema.methods.toJSON = function () {
  const obj = this.toObject();
  if (obj.aadhaar) {
    obj.aadhaar = maskAadhaar(obj.aadhaar);
  }
  return obj;
};

const Customer = mongoose.model('Customer', customerSchema);
Customer.schema = customerSchema;
module.exports = Customer;
