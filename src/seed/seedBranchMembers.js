require('dotenv').config();
const mongoose = require('mongoose');
const { BRANCHES } = require('../config/branchNumbers');
const BranchMember = require('../models/BranchMember');

async function seedBranchMembers() {
  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI is not set in environment or .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB database: ${mongoose.connection.name}`);

  const results = [];

  for (const [branch, numbers] of Object.entries(BRANCHES)) {
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
  }

  console.log(`\nSeed completed successfully: ${results.length} branch members upserted.`);
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

seedBranchMembers().catch((err) => {
  console.error('Seeding branch members failed:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});

