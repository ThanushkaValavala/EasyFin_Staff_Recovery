require('dotenv').config();
const mongoose = require('mongoose');
const HIDE = new Set(['password', 'passwordHash', 'otp', 'otpHash', 'hash', 'rawRemarks', 'aadhaar', '__v']);
const cell = v => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ');
  if (Array.isArray(v)) return '[' + v.length + ' items]';
  if (typeof v === 'object') return v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID' ? String(v).slice(-6) : '{...}';
  const s = String(v);
  return s.length > 28 ? s.slice(0, 27) + '…' : s;
};
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const only = process.argv[2];
  const limit = Number(process.argv[3]) || 5;
  console.log('DATABASE:', db.databaseName, '\n');
  const names = (await db.listCollections().toArray()).map(c => c.name).sort();
  for (const n of names) {
    if (only && n !== only) continue;
    const col = db.collection(n);
    const count = await col.countDocuments();
    console.log('== ' + n + '  (' + count + ' documents) ==');
    if (!count) { console.log('(empty)\n'); continue; }
    const rows = (await col.find({}).limit(only ? limit : 5).toArray()).map(d => {
      const o = {};
      for (const [k, v] of Object.entries(d)) if (!HIDE.has(k)) o[k] = cell(v);
      return o;
    });
    console.table(rows);
    console.log('');
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
