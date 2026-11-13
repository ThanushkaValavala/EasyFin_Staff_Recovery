require('dotenv').config();
const mongoose = require('mongoose');
const apply = process.argv.includes('--apply');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('assignments');
  console.log('Database:', mongoose.connection.db.databaseName, '| assignments:', await col.countDocuments());
  if (!apply) { console.log('DRY RUN: nothing changed. Add --apply to run.'); return mongoose.disconnect(); }
  const back = mongoose.connection.db.collection('assignments_state_backup');
  const docs = await col.find({}, { projection: { recoveryStatus: 1, lastVisitDate: 1, notes: 1 } }).toArray();
  if (docs.length) await back.insertMany(docs.map(d => ({ assignmentId: d._id, recoveryStatus: d.recoveryStatus, lastVisitDate: d.lastVisitDate, notes: d.notes, savedAt: new Date() })));
  const r = await col.updateMany({}, { $set: { recoveryStatus: 'PENDING', status: 'ASSIGNED', lastVisitDate: null, notes: '', updatedAt: new Date() } });
  console.log('Reset', r.modifiedCount, 'assignments (old values saved in assignments_state_backup)');
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
