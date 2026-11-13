require('dotenv').config();
const mongoose = require('mongoose');
const apply = process.argv.includes('--apply');
const PHONE = '9876543210';
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const ids = [];
  for (const c of ['staffs', 'users'])
    for (const d of await db.collection(c).find({}).toArray())
      if (last10(d.phone) === PHONE) ids.push(d._id);
  console.log('Agent records for', PHONE + ':', ids.length);
  const filter = { $or: [{ agentId: { $in: ids } }, { staffId: { $in: ids } }] };
  const sessions = await db.collection('recoverysessions').find(filter).toArray();
  console.log('Sessions found:', sessions.length);
  if (apply && sessions.length) {
    const arch = db.collection('recoverysessions_archive');
    await arch.insertMany(sessions.map(s => ({ ...s, archivedAt: new Date() })), { ordered: false }).catch(e => {
      if (e.code !== 11000 && !(e.writeErrors || []).every(w => w.code === 11000)) throw e;
    });
    const archived = await arch.countDocuments({ _id: { $in: sessions.map(s => s._id) } });
    if (archived !== sessions.length) throw new Error('Archive count mismatch: ' + archived + ' of ' + sessions.length + '. Nothing deleted.');
    const del = await db.collection('recoverysessions').deleteMany({ _id: { $in: sessions.map(s => s._id) } });
    console.log('Archived', archived, 'and removed', del.deletedCount, 'from recoverysessions');
  } else {
    console.log('DRY RUN: nothing changed. Add --apply to archive.');
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
