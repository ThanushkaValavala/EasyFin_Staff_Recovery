require('dotenv').config();
const { BRANCHES } = require('../config/branchNumbers');
const { connectBranchDbs, getModels, isBranchDbConnected } = require('../config/branchDb');

async function seedBranchMembers() {
  const branch = process.argv[2];

  if (!branch || !['Branch 1', 'Branch 2'].includes(branch)) {
    console.error('Error: A valid branch argument ("Branch 1" or "Branch 2") is required.');
    console.error('Usage: node src/seed/seedBranchMembers.js "<Branch 1|Branch 2>"');
    process.exit(1);
  }

  await connectBranchDbs();

  if (!isBranchDbConnected(branch)) {
    console.error(`Error: Could not connect to database for ${branch}`);
    process.exit(1);
  }

  const models = getModels(branch);
  const BranchMember = models.BranchMember;

  const numbers = BRANCHES[branch] || [];
  const results = [];

  for (const rawPhone of numbers) {
    const phone = BranchMember.normalize(rawPhone);
    if (!phone || phone.length !== 10) {
      console.warn(`Skipping invalid phone: ${rawPhone}`);
      continue;
    }

    const member = await BranchMember.findOneAndUpdate(
      { phone },
      {
        $set: {
          phone,
          branch,
          isActive: true,
        },
        $setOnInsert: {
          name: '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    results.push({ phone: member.phone, branch: member.branch, id: member._id });
    console.log(`Upserted ${member.phone} under '${member.branch}'`);
  }

  console.log(`\nSeed completed successfully: ${results.length} branch members upserted to ${branch}.`);
  process.exit(0);
}

seedBranchMembers().catch((err) => {
  console.error('Seeding branch members failed:', err);
  process.exit(1);
});
