const mongoose = require('mongoose');

const branchMemberSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    branch: {
      type: String,
      required: true,
      enum: ['Branch 1', 'Branch 2'],
    },
    name: {
      type: String,
      default: '',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

branchMemberSchema.statics.normalize = function (phone) {
  if (!phone && phone !== 0) {
    return '';
  }
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-10);
};

const BranchMember = mongoose.model('BranchMember', branchMemberSchema);
BranchMember.schema = branchMemberSchema;
module.exports = BranchMember;

