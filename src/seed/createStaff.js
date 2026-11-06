require('dotenv').config();
const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const { generateStrongPassword } = require('../services/passwordGenerator');

// Usage: node src/seed/createStaff.js --employeeId=EF-ADM-001 "--name=Admin User" --email=a@b.com --phone=9876543210 "--assignedArea=Head Office" --role=admin
const args = {};
process.argv.slice(2).forEach((a) => {
  const clean = a.replace(/^--/, '');
  const i = clean.indexOf('=');
  if (i > 0) args[clean.slice(0, i)] = clean.slice(i + 1);
});

(async () => {
  const required = ['employeeId', 'name', 'email', 'phone', 'assignedArea'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length) {
    console.error('Missing: ' + missing.join(', '));
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('Set MONGODB_URI first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const password = generateStrongPassword();

  const staff = await Staff.create({
    employeeId: args.employeeId.trim().toUpperCase(),
    name: args.name.trim(),
    email: args.email.trim().toLowerCase(),
    phone: args.phone.trim(),
    assignedArea: args.assignedArea.trim(),
    role: args.role || 'field_officer',
    password,
    isActive: true
  });

  console.log('Created: ' + staff.employeeId + ' (' + staff.role + ')');
  console.log('Login ID : ' + staff.employeeId + '  or  ' + staff.email);
  console.log('Password : ' + password);
  console.log('Save this now. It is not stored in readable form.');
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.code === 11000 ? 'That Employee ID or email already exists.' : e.message);
  process.exit(1);
});