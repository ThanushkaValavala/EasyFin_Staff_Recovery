require('dotenv').config();
const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const Customer = require('../models/Customer');
const Staff = require('../models/Staff');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected database : ' + mongoose.connection.name);
  console.log('Staff              : ' + await Staff.countDocuments({}));
  console.log('Customers          : ' + await Customer.countDocuments({}));
  console.log('Customers with area: ' + await Customer.countDocuments({ area: { $nin: ['', null] } }));
  console.log('Assignments        : ' + await Assignment.countDocuments({}));
  try {
    const dbs = await mongoose.connection.db.admin().listDatabases();
    console.log('Databases on cluster: ' + dbs.databases.map(d => d.name).join(', '));
  } catch (e) {
    console.log('Could not list databases: ' + e.message);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });