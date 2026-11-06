require('dotenv').config();
const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const Customer = require('../models/Customer');
const Staff = require('../models/Staff');

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('Set MONGODB_URI first.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const assignments = await Assignment.find({});
  let updated = 0;
  for (const a of assignments) {
    const staff = await Staff.findById(a.staffId);
    if (!staff) continue;
    const r = await Customer.updateOne(
      { _id: a.customerId, $or: [{ area: '' }, { area: { $exists: false } }] },
      { $set: { area: staff.assignedArea } }
    );
    updated += r.modifiedCount;
  }
  console.log('Customers updated with area: ' + updated);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });