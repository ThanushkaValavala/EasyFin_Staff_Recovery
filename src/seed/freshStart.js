require('dotenv').config();
const mongoose = require('mongoose');
const apply = process.argv.includes('--apply');
const ARCHIVE = ['recoverysessions', 'evidences', 'trackingpoints', 'stopevents', 'recoveryreports'];
const CLEAR = ['agent_history_summary', 'otprecords'];
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('Database:', db.databaseName);
  const plan = [];
  for (const n of [...ARCHIVE, ...CLEAR]) plan.push([n, await db.collection(n).countDocuments()]);
  plan.forEach(([n, c]) => console.log(n.padEnd(24), c));
  if (!apply) { console.log('DRY RUN: nothing changed. Add --apply to run.'); return mongoose.disconnect(); }

  for (const n of ARCHIVE) {
    const docs = await db.collection(n).find({}).toArray();
    if (!docs.length) continue;
    const arch = db.collection(n + '_archive');
    await arch.insertMany(docs.map(d => ({ ...d, archivedAt: new Date() })), { ordered: false }).catch(e => {
      if (e.code !== 11000 && !(e.writeErrors || []).every(w => w.code === 11000)) throw e;
    });
    const have = await arch.countDocuments({ _id: { $in: docs.map(d => d._id) } });
    if (have !== docs.length) throw new Error(n + ': archive count mismatch (' + have + ' of ' + docs.length + '). Nothing deleted for this collection.');
    const del = await db.collection(n).deleteMany({ _id: { $in: docs.map(d => d._id) } });
    console.log('Archived and cleared', n, del.deletedCount);
  }
  for (const n of CLEAR) {
    const del = await db.collection(n).deleteMany({});
    console.log('Cleared', n, del.deletedCount);
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
