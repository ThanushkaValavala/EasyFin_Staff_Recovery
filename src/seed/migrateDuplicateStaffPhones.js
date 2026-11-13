require('dotenv').config();
const mongoose = require('mongoose');
const { normalizePhoneNumber } = require('../utils/phoneNormalizer');

async function run() {
  const isExecute = process.argv.includes('--execute');
  const isDryRun = !isExecute || process.argv.includes('--dry-run');

  console.log('====================================================');
  console.log(`DUPLICATE STAFF/USER PHONE MIGRATION [${isExecute ? 'EXECUTE' : 'DRY RUN'}]`);
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB database:', mongoose.connection.name);

  // We inspect both 'users' and 'staffs' collections
  const rawUsers = await mongoose.connection.db.collection('users').find({}).toArray();
  const rawStaffs = await mongoose.connection.db.collection('staffs').find({}).toArray();

  console.log(`Found ${rawUsers.length} in 'users' collection, ${rawStaffs.length} in 'staffs' collection.`);

  // If there are legacy records in 'staffs' that are not in 'users', we should unify them into 'users'
  // Let's check how many recoveries/assignments reference them
  const allRecords = [];
  rawUsers.forEach(u => allRecords.push({ ...u, sourceCollection: 'users' }));
  rawStaffs.forEach(s => {
    // Check if same _id already exists in rawUsers
    const exists = rawUsers.some(u => u._id.toString() === s._id.toString());
    if (!exists) {
      allRecords.push({ ...s, sourceCollection: 'staffs' });
    }
  });

  console.log(`Total unique identity records across collections: ${allRecords.length}`);

  // Group by normalized phone
  const groups = new Map();
  for (const record of allRecords) {
    const rawPhone = record.phone || '';
    const normPhone = normalizePhoneNumber(rawPhone);
    if (!groups.has(normPhone)) {
      groups.set(normPhone, []);
    }
    groups.get(normPhone).push(record);
  }

  console.log(`Found ${groups.size} unique normalized phone groups:\n`);

  let duplicateGroupsCount = 0;
  let reassignedSessionsTotal = 0;
  let reassignedAssignmentsTotal = 0;
  let reassignedPointsTotal = 0;
  let removedDuplicatesTotal = 0;

  for (const [normPhone, records] of groups.entries()) {
    console.log(`Phone: [${normPhone}] (Count: ${records.length})`);
    records.forEach(r => {
      console.log(`  - _id: ${r._id} | from: ${r.sourceCollection} | name: ${r.name} | empId: ${r.employeeId} | email: ${r.email} | rawPhone: ${r.phone}`);
    });

    if (records.length > 1) {
      duplicateGroupsCount++;
      console.log(`  ⚠️ Duplicate group detected for ${normPhone}! Selecting canonical record...`);

      // Ranking:
      // 1. Records with assignments or recovery sessions
      // 2. Records with real name / employeeId (not starting with 'PHONE_')
      // 3. Earliest createdAt
      let canonical = records[0];
      for (const rec of records) {
        const recSessionCount = await mongoose.connection.db.collection('recoverysessions').countDocuments({
          $or: [{ staffId: rec._id }, { agentId: rec._id }]
        });
        const recAssignmentCount = await mongoose.connection.db.collection('assignments').countDocuments({
          $or: [{ staffId: rec._id }, { agentId: rec._id }]
        });
        rec._relCount = recSessionCount + recAssignmentCount;
      }

      records.sort((a, b) => {
        if (b._relCount !== a._relCount) return b._relCount - a._relCount;
        const aIsDemo = (a.employeeId || '').startsWith('PHONE_');
        const bIsDemo = (b.employeeId || '').startsWith('PHONE_');
        if (!aIsDemo && bIsDemo) return -1;
        if (aIsDemo && !bIsDemo) return 1;
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      });

      canonical = records[0];
      const duplicates = records.slice(1);

      console.log(`  ✅ Canonical selected: _id: ${canonical._id} (${canonical.name}, ${canonical.employeeId}) [relations: ${canonical._relCount}]`);
      duplicates.forEach(d => {
        console.log(`  ❌ Duplicate marked for merge: _id: ${d._id} (${d.name}, ${d.employeeId}) [relations: ${d._relCount}]`);
      });

      if (isExecute) {
        for (const dup of duplicates) {
          // Reassign assignments
          const aRes = await mongoose.connection.db.collection('assignments').updateMany(
            { staffId: dup._id },
            { $set: { staffId: canonical._id } }
          );
          reassignedAssignmentsTotal += aRes.modifiedCount;

          // Reassign recovery sessions
          const sRes = await mongoose.connection.db.collection('recoverysessions').updateMany(
            { staffId: dup._id },
            { $set: { staffId: canonical._id } }
          );
          reassignedSessionsTotal += sRes.modifiedCount;

          // Reassign tracking points
          const pRes = await mongoose.connection.db.collection('trackingpoints').updateMany(
            { staffId: dup._id },
            { $set: { staffId: canonical._id } }
          );
          reassignedPointsTotal += pRes.modifiedCount;

          // Delete duplicate record from users and staffs
          await mongoose.connection.db.collection('users').deleteOne({ _id: dup._id });
          await mongoose.connection.db.collection('staffs').deleteOne({ _id: dup._id });
          removedDuplicatesTotal++;
          console.log(`  Deleted duplicate _id: ${dup._id} and merged into canonical _id: ${canonical._id}`);
        }

        // Ensure canonical is in 'users' with normalized phone
        canonical.phone = normPhone;
        await mongoose.connection.db.collection('users').updateOne(
          { _id: canonical._id },
          { $set: { phone: normPhone } },
          { upsert: true }
        );
      }
    } else {
      // Single record: ensure phone is normalized in DB
      const single = records[0];
      if (isExecute && single.phone !== normPhone) {
        await mongoose.connection.db.collection('users').updateOne(
          { _id: single._id },
          { $set: { phone: normPhone } },
          { upsert: true }
        );
        console.log(`  Updated phone to normalized ${normPhone} for _id: ${single._id}`);
      } else if (isExecute && single.sourceCollection === 'staffs') {
        // Also ensure copy is in 'users'
        await mongoose.connection.db.collection('users').updateOne(
          { _id: single._id },
          { $set: { ...single, phone: normPhone } },
          { upsert: true }
        );
      }
    }
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY:`);
  console.log(`Duplicate phone groups: ${duplicateGroupsCount}`);
  if (isExecute) {
    console.log(`Reassigned RecoverySessions: ${reassignedSessionsTotal}`);
    console.log(`Reassigned Assignments: ${reassignedAssignmentsTotal}`);
    console.log(`Reassigned TrackingPoints: ${reassignedPointsTotal}`);
    console.log(`Removed duplicate records: ${removedDuplicatesTotal}`);
  }
  console.log('----------------------------------------------------');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

