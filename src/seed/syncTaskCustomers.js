require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Staff = require('../models/Staff');
const { getModels } = require('../config/branchDb');

const CUSTOMERS_DATA = [
  {
    customerId: 'CUST-8021',
    name: 'Vikramaditya Roy',
    customerName: 'Vikramaditya Roy',
    phone: '+919823456789',
    phoneNumber: '+919823456789',
    address: 'Flat 402, Nilgiri Heights, Sarjapur Main Road',
    fullAddress: 'Flat 402, Nilgiri Heights, Sarjapur Main Road',
    area: 'Sarjapur',
    location: 'Sarjapur',
    city: 'Bangalore',
    latitude: 12.9249,
    longitude: 77.6834,
    recoveryStatus: 'ASSIGNED'
  },
  {
    customerId: 'CUST-8022',
    name: 'Ananya Deshmukh',
    customerName: 'Ananya Deshmukh',
    phone: '+919845122334',
    phoneNumber: '+919845122334',
    address: 'Plot 15, Green Glen Layout, Kasavanahalli',
    fullAddress: 'Plot 15, Green Glen Layout, Kasavanahalli',
    area: 'Kasavanahalli',
    location: 'Kasavanahalli',
    city: 'Bangalore',
    latitude: 12.9063,
    longitude: 77.6775,
    recoveryStatus: 'ASSIGNED'
  },
  {
    customerId: 'CUST-8023',
    name: 'Mohammed Faizan',
    customerName: 'Mohammed Faizan',
    phone: '+919731288491',
    phoneNumber: '+919731288491',
    address: 'Shop 4, Commercial Complex, Marathahalli Bridge',
    fullAddress: 'Shop 4, Commercial Complex, Marathahalli Bridge',
    area: 'Marathahalli',
    location: 'Marathahalli',
    city: 'Bangalore',
    latitude: 12.9591,
    longitude: 77.6974,
    recoveryStatus: 'ASSIGNED'
  },
  {
    customerId: 'CUST-8024',
    name: 'Suresh Kumar Gupta',
    customerName: 'Suresh Kumar Gupta',
    phone: '+919900177665',
    phoneNumber: '+919900177665',
    address: 'House 88, 3rd Cross, Kasavanahalli Road',
    fullAddress: 'House 88, 3rd Cross, Kasavanahalli Road',
    area: 'Kasavanahalli',
    location: 'Kasavanahalli',
    city: 'Bangalore',
    latitude: 12.9080,
    longitude: 77.6790,
    recoveryStatus: 'ASSIGNED'
  },
  {
    customerId: 'CUST-8025',
    name: 'Meenakshi Sundaram',
    customerName: 'Meenakshi Sundaram',
    phone: '+919611255443',
    phoneNumber: '+919611255443',
    address: 'No. 24, 7th Main, Sarjapur Outer Ring Road',
    fullAddress: 'No. 24, 7th Main, Sarjapur Outer Ring Road',
    area: 'Sarjapur',
    location: 'Sarjapur',
    city: 'Bangalore',
    latitude: 12.9230,
    longitude: 77.6810,
    recoveryStatus: 'ASSIGNED'
  },
  {
    customerId: 'CUST-8026',
    name: 'Ramesh Patel',
    customerName: 'Ramesh Patel',
    phone: '+919811223344',
    phoneNumber: '+919811223344',
    address: 'Building 12, Spice Garden, Marathahalli',
    fullAddress: 'Building 12, Spice Garden, Marathahalli',
    area: 'Marathahalli',
    location: 'Marathahalli',
    city: 'Bangalore',
    latitude: 12.9560,
    longitude: 77.7010,
    recoveryStatus: 'ASSIGNED'
  }
];

async function syncDb(uri, label) {
  if (!uri) return;
  console.log(`Connecting to ${label}...`);
  const conn = await mongoose.createConnection(uri).asPromise();
  const CustModel = conn.models.Customer || conn.model('Customer', Customer.schema, 'customers');
  const StaffModel = conn.models.Staff || conn.model('Staff', Staff.schema, 'users');

  // Find all active agents in this database
  const agents = await StaffModel.find({ isActive: true }).lean();
  const agentIds = agents.map((a) => a._id);
  const primaryAgentId = agentIds[0] || null;

  console.log(`Found ${agents.length} agents in ${label}`);

  for (const item of CUSTOMERS_DATA) {
    const existing = await CustModel.findOne({ customerId: item.customerId });
    if (existing) {
      // Update location, area, address, preserve existing recoveryStatus unless unset
      existing.name = item.name;
      existing.customerName = item.customerName;
      existing.phone = item.phone;
      existing.phoneNumber = item.phoneNumber;
      existing.address = item.address;
      existing.fullAddress = item.fullAddress;
      existing.area = item.area;
      existing.location = item.location;
      existing.city = item.city;
      existing.latitude = item.latitude;
      existing.longitude = item.longitude;
      if (!existing.recoveryStatus) existing.recoveryStatus = 'ASSIGNED';
      existing.assignedRecoveryAgentId = primaryAgentId;
      existing.assignedRecoveryAgentIds = agentIds;
      await existing.save();
      console.log(`Updated customer ${item.customerId} in ${label}`);
    } else {
      await CustModel.create({
        ...item,
        assignedRecoveryAgentId: primaryAgentId,
        assignedRecoveryAgentIds: agentIds
      });
      console.log(`Inserted customer ${item.customerId} in ${label}`);
    }
  }

  await conn.close();
}

async function run() {
  await syncDb(process.env.MONGODB_URI, 'loan_recovery_updated');
  await syncDb(process.env.MONGODB_URI_BRANCH1, 'branch1_db');
  await syncDb(process.env.MONGODB_URI_BRANCH2, 'branch2_db');
  console.log('Customer sync complete!');
  process.exit(0);
}

run().catch((e) => {
  console.error('Customer sync failed:', e);
  process.exit(1);
});
