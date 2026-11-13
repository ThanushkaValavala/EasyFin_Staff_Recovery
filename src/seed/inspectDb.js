require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('Database:', db.databaseName);
  const cols = await db.listCollections().toArray();
  for (const c of cols) {
    const n = await db.collection(c.name).countDocuments();
    console.log(c.name.padEnd(22), n);
  }
  for (const name of ['staffs','users','recoverysessions']) {
    const d = await db.collection(name).findOne({}, { projection: { passwordHash:0, password:0 } });
    if (d) console.log('\nSample', name, JSON.stringify(d, null, 1).slice(0, 800));
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
