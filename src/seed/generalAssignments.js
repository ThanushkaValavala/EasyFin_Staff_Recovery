require('dotenv').config();
const mongoose = require('mongoose');
const apply = process.argv.includes('--apply');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('Database:', db.databaseName);
  const col = db.collection('assignments');
  const total = await col.countDocuments();
  const linked = await col.countDocuments({ $or: [{ staffId: { $exists: true } }, { agentId: { $exists: true } }] });
  console.log('assignments:', total, '| linked to an agent:', linked);
  if (!apply) { console.log('DRY RUN: nothing changed. Add --apply to run.'); return mongoose.disconnect(); }

  // back up the old links so this can be undone
  const arch = db.collection('assignments_links_backup');
  const docs = await col.find({}, { projection: { staffId: 1, agentId: 1 } }).toArray();
  if (docs.length) await arch.insertMany(docs.map(d => ({ assignmentId: d._id, staffId: d.staffId, agentId: d.agentId, savedAt: new Date() })));
  const r = await col.updateMany({}, { $unset: { staffId: '', agentId: '' }, $set: { status: 'ASSIGNED', updatedAt: new Date() } });
  console.log('Unlinked', r.modifiedCount, 'assignments (backup in assignments_links_backup)');
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
