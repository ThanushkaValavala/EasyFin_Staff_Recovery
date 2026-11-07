const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const maskAadhaar = (val) => {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if (digits.length >= 4) {
    return `XXXX-XXXX-${digits.slice(-4)}`;
  }
  return val;
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Full name is required'], trim: true },
    username: { type: String, required: [true, 'Username is required'], unique: true, trim: true, lowercase: true, index: true },
    employeeId: { type: String, default: '' },
    email: { type: String, required: [true, 'Email address is required'], unique: true, trim: true, lowercase: true, index: true },
    password: { type: String, required: [true, 'Password is required'] },
    aadhaar: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    assignedArea: { type: String, default: '', trim: true },
    role: { type: String, enum: ['field_officer', 'recovery_supervisor', 'admin'], default: 'field_officer' },
    isActive: { type: Boolean, default: true }
  },
  {
    timestamps: true,
    collection: 'users'
  }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  if (obj.aadhaar) {
    obj.aadhaar = maskAadhaar(obj.aadhaar);
  }
  return obj;
};

module.exports = mongoose.model('User', userSchema);
