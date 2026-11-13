require('dotenv').config();
const mongoose = require('mongoose');
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('DATABASE:', db.databaseName, '\n');

  console.log('COLLECTIONS');
  const cols = (await db.listCollections().toArray()).map(c => c.name).sort();
  for (const n of cols) console.log(' ', n.padEnd(28), await db.collection(n).countDocuments());

  console.log('\nAGENTS (mobile / collection / name / area)');
  for (const c of ['staffs', 'users'])
    for (const d of await db.collection(c).find({}).toArray())
      console.log(' ', last10(d.phone).padEnd(12), c.padEnd(7), String(d.name || '-').padEnd(20), d.assignedArea || '-');

  console.log('\nASSIGNMENTS');
  for (const a of await db.collection('assignments').find({}).limit(10).toArray())
    console.log(' ', JSON.stringify({ status: a.status, staffId: a.staffId, agentId: a.agentId, customerId: a.customerId }));

  console.log('\nCUSTOMERS (name / area)');
  for (const c of await db.collection('customers').find({}).limit(10).toArray())
    console.log(' ', String(c.name || c.fullName || '-').padEnd(24), c.area || c.address || '-');

  console.log('\nRECOVERY SESSIONS:', await db.collection('recoverysessions').countDocuments());
  console.log('SUMMARY TABLE ROWS:', await db.collection('agent_history_summary').countDocuments());
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
