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
    name: { type: String, trim: true, default: '' },
    customerName: { type: String, trim: true, default: '' },
    aadhaar: { type: String, default: '', trim: true },
    dob: { type: Date, default: null },
    address: { type: String, trim: true, default: '' },
    fullAddress: { type: String, trim: true, default: '' },
    area: { type: String, trim: true, default: '', index: true },
    location: { type: String, trim: true, default: '', index: true },
    landmark: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    phoneNumber: { type: String, default: '', trim: true },
    alternatePhone: { type: String, default: '', trim: true },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },

    // Agent Assignment
    assignedRecoveryAgentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', index: true, default: null },
    assignedRecoveryAgentIds: [{ type: mongoose.Schema.Types.Mixed, ref: 'Staff', index: true }],
    assignedAgentName: { type: String, default: '' },
    assignedAgentPhone: { type: String, default: '' },

    // Recovery Lifecycle Status
    recoveryStatus: {
      type: String,
      enum: ['ASSIGNED', 'RECOVERY_IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      default: 'ASSIGNED',
      index: true
    },

    // Recovery Lock
    activeRecoverySessionId: { type: String, default: null, index: true },
    activeRecoveryAgentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', default: null },
    activeAgentName: { type: String, default: '' },
    activeAgentPhone: { type: String, default: '' },
    lockedAt: { type: Date, default: null },

    // Stage 1 (Session) Submission timestamp
    sessionSubmittedAt: { type: Date, default: null },

    // Stage 2 (Task Completion)
    completedAt: { type: Date, default: null },
    completedByAgentId: { type: mongoose.Schema.Types.Mixed, ref: 'Staff', default: null },
    completedSessionId: { type: String, default: null }
  },
  {
    timestamps: true,
    collection: 'customers'
  }
);

customerSchema.pre('validate', function (next) {
  // Sync name <-> customerName
  if (!this.name && this.customerName) this.name = this.customerName;
  if (!this.customerName && this.name) this.customerName = this.name;

  // Sync phone <-> phoneNumber
  if (!this.phone && this.phoneNumber) this.phone = this.phoneNumber;
  if (!this.phoneNumber && this.phone) this.phoneNumber = this.phone;

  // Sync address <-> fullAddress
  if (!this.address && this.fullAddress) this.address = this.fullAddress;
  if (!this.fullAddress && this.address) this.fullAddress = this.address;

  // Sync area <-> location
  if (!this.area && this.location) this.area = this.location;
  if (!this.location && this.area) this.location = this.area;

  next();
});

customerSchema.pre('save', function (next) {
  // Ensure sync in pre-save as well
  if (!this.name && this.customerName) this.name = this.customerName;
  if (!this.customerName && this.name) this.customerName = this.name;

  if (!this.phone && this.phoneNumber) this.phone = this.phoneNumber;
  if (!this.phoneNumber && this.phone) this.phoneNumber = this.phone;

  if (!this.address && this.fullAddress) this.address = this.fullAddress;
  if (!this.fullAddress && this.address) this.fullAddress = this.address;

  if (!this.area && this.location) this.area = this.location;
  if (!this.location && this.area) this.location = this.area;

  if (this.assignedRecoveryAgentId && (!this.assignedRecoveryAgentIds || !this.assignedRecoveryAgentIds.length)) {
    this.assignedRecoveryAgentIds = [this.assignedRecoveryAgentId];
  }

  next();
});

customerSchema.methods.toJSON = function () {
  const obj = this.toObject();
  if (obj.aadhaar) {
    obj.aadhaar = maskAadhaar(obj.aadhaar);
  }
  // Guarantee aliases are populated
  obj.customerName = obj.customerName || obj.name || '';
  obj.name = obj.name || obj.customerName || '';
  obj.phoneNumber = obj.phoneNumber || obj.phone || '';
  obj.phone = obj.phone || obj.phoneNumber || '';
  obj.fullAddress = obj.fullAddress || obj.address || '';
  obj.address = obj.address || obj.fullAddress || '';
  obj.location = obj.location || obj.area || '';
  obj.area = obj.area || obj.location || '';
  return obj;
};

const Customer = mongoose.model('Customer', customerSchema);
Customer.schema = customerSchema;
module.exports = Customer;
