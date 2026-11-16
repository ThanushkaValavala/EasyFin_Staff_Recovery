require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const isExecute = process.argv.includes('--execute');
  const isDryRun = !isExecute || process.argv.includes('--dry-run');

  console.log('====================================================');
  console.log(`STAFFID TO AGENTID MIGRATION [${isExecute ? 'EXECUTE' : 'DRY RUN'}]`);
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB database:', mongoose.connection.name);

  // 1. RecoverySessions
  const sessions = await mongoose.connection.db.collection('recoverysessions').find({}).toArray();
  console.log(`Found ${sessions.length} total RecoverySession documents.`);

  let migratedSessionsCount = 0;
  let alreadyHasAgentIdSessionsCount = 0;
  let unresolvedSessionsCount = 0;

  for (const session of sessions) {
    const existingStaffId = session.staffId;
    const existingAgentId = session.agentId;

    if (!existingAgentId && existingStaffId) {
      // Validate referenced staff/user exists
      const user = await mongoose.connection.db.collection('users').findOne({ _id: existingStaffId });
      const staff = await mongoose.connection.db.collection('staffs').findOne({ _id: existingStaffId });

      if (!user && !staff) {
        console.warn(`  ⚠️ Unresolved staffId reference on RecoverySession ${session.sessionId || session._id}: staffId ${existingStaffId} not found in users or staffs!`);
        unresolvedSessionsCount++;
      } else {
        migratedSessionsCount++;
        console.log(`  Session ${session.sessionId || session._id}: copying staffId (${existingStaffId}) -> agentId`);
        if (isExecute) {
          await mongoose.connection.db.collection('recoverysessions').updateOne(
            { _id: session._id },
            { $set: { agentId: existingStaffId } }
          );
        }
      }
    } else if (existingAgentId) {
      alreadyHasAgentIdSessionsCount++;
    }
  }

  // 2. Assignments
  const assignments = await mongoose.connection.db.collection('assignments').find({}).toArray();
  console.log(`\nFound ${assignments.length} total Assignment documents.`);
  let migratedAssignmentsCount = 0;

  for (const a of assignments) {
    if (!a.agentId && a.staffId) {
      migratedAssignmentsCount++;
      console.log(`  Assignment ${a.assignmentId || a._id}: copying staffId (${a.staffId}) -> agentId`);
      if (isExecute) {
        await mongoose.connection.db.collection('assignments').updateOne(
          { _id: a._id },
          { $set: { agentId: a.staffId } }
        );
      }
    }
  }

  // 3. TrackingPoints
  const pointsWithoutAgent = await mongoose.connection.db.collection('trackingpoints').countDocuments({
    agentId: { $exists: false },
    staffId: { $exists: true }
  });
  console.log(`\nFound ${pointsWithoutAgent} TrackingPoint documents needing agentId.`);
  if (isExecute && pointsWithoutAgent > 0) {
    // Copy staffId to agentId using an update pipeline (MongoDB 4.2+)
    const res = await mongoose.connection.db.collection('trackingpoints').updateMany(
      { agentId: { $exists: false }, staffId: { $exists: true } },
      [{ $set: { agentId: '$staffId' } }]
    );
    console.log(`  Updated ${res.modifiedCount} TrackingPoints with agentId.`);
  }

  console.log('\n----------------------------------------------------');
  console.log(`SUMMARY:`);
  console.log(`Sessions migrated (staffId -> agentId): ${migratedSessionsCount}`);
  console.log(`Sessions already having agentId: ${alreadyHasAgentIdSessionsCount}`);
  console.log(`Unresolved session references: ${unresolvedSessionsCount}`);
  console.log(`Assignments migrated: ${migratedAssignmentsCount}`);
  console.log(`Tracking points needing migration: ${pointsWithoutAgent}`);
  console.log('----------------------------------------------------');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

