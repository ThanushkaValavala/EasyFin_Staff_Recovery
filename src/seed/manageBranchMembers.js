require('dotenv').config();
const mongoose = require('mongoose');
const BranchMember = require('../models/BranchMember');

const ALLOWED_BRANCHES = ['Branch 1', 'Branch 2'];

function printUsage() {
  console.log(`
Usage:
  node src/seed/manageBranchMembers.js add <phone> "<Branch 1|Branch 2>" "<name>"
  node src/seed/manageBranchMembers.js move <phone> "<branch>"
  node src/seed/manageBranchMembers.js deactivate <phone>
  node src/seed/manageBranchMembers.js activate <phone>
  node src/seed/manageBranchMembers.js list
`);
}

async function run() {
  const [, , action, ...args] = process.argv;

  if (!action || !['add', 'move', 'deactivate', 'activate', 'list'].includes(action)) {
    printUsage();
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI is not set in environment or .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    switch (action) {
      case 'add': {
        const [rawPhone, branch, name = ''] = args;
        if (!rawPhone || !branch) {
          console.error('Error: <phone> and <branch> are required for "add".');
          printUsage();
          process.exitCode = 1;
          break;
        }

        const phone = BranchMember.normalize(rawPhone);
        if (!phone || phone.length !== 10) {
          console.error(`Error: Invalid phone "${rawPhone}". Must contain at least 10 digits.`);
          process.exitCode = 1;
          break;
        }

        if (!ALLOWED_BRANCHES.includes(branch)) {
          console.error(`Error: Invalid branch "${branch}". Must be one of: ${ALLOWED_BRANCHES.join(', ')}`);
          process.exitCode = 1;
          break;
        }

        const member = await BranchMember.findOneAndUpdate(
          { phone },
          {
            $set: {
              phone,
              branch,
              name: String(name).trim(),
              isActive: true,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        console.log('Successfully added / updated branch member:');
        console.log({
          phone: member.phone,
          branch: member.branch,
          name: member.name,
          isActive: member.isActive,
          id: member._id,
        });
        break;
      }

      case 'move': {
        const [rawPhone, branch] = args;
        if (!rawPhone || !branch) {
          console.error('Error: <phone> and <branch> are required for "move".');
          printUsage();
          process.exitCode = 1;
          break;
        }

        const phone = BranchMember.normalize(rawPhone);
        if (!phone || phone.length !== 10) {
          console.error(`Error: Invalid phone "${rawPhone}". Must contain at least 10 digits.`);
          process.exitCode = 1;
          break;
        }

        if (!ALLOWED_BRANCHES.includes(branch)) {
          console.error(`Error: Invalid branch "${branch}". Must be one of: ${ALLOWED_BRANCHES.join(', ')}`);
          process.exitCode = 1;
          break;
        }

        const member = await BranchMember.findOneAndUpdate(
          { phone },
          { $set: { branch } },
          { new: true }
        );

        if (!member) {
          console.error(`Member with phone ${phone} not found.`);
          process.exitCode = 1;
        } else {
          console.log(`Successfully moved member ${phone} to ${branch}:`);
          console.log({
            phone: member.phone,
            branch: member.branch,
            name: member.name,
            isActive: member.isActive,
          });
        }
        break;
      }

      case 'deactivate': {
        const [rawPhone] = args;
        if (!rawPhone) {
          console.error('Error: <phone> is required for "deactivate".');
          printUsage();
          process.exitCode = 1;
          break;
        }

        const phone = BranchMember.normalize(rawPhone);
        const member = await BranchMember.findOneAndUpdate(
          { phone },
          { $set: { isActive: false } },
          { new: true }
        );

        if (!member) {
          console.error(`Member with phone ${phone} not found.`);
          process.exitCode = 1;
        } else {
          console.log(`Successfully deactivated member ${phone}:`);
          console.log({
            phone: member.phone,
            branch: member.branch,
            name: member.name,
            isActive: member.isActive,
          });
        }
        break;
      }

      case 'activate': {
        const [rawPhone] = args;
        if (!rawPhone) {
          console.error('Error: <phone> is required for "activate".');
          printUsage();
          process.exitCode = 1;
          break;
        }

        const phone = BranchMember.normalize(rawPhone);
        const member = await BranchMember.findOneAndUpdate(
          { phone },
          { $set: { isActive: true } },
          { new: true }
        );

        if (!member) {
          console.error(`Member with phone ${phone} not found.`);
          process.exitCode = 1;
        } else {
          console.log(`Successfully activated member ${phone}:`);
          console.log({
            phone: member.phone,
            branch: member.branch,
            name: member.name,
            isActive: member.isActive,
          });
        }
        break;
      }

      case 'list': {
        const members = await BranchMember.find({}).sort({ branch: 1, phone: 1 }).lean();
        if (members.length === 0) {
          console.log('No branch members found in database.');
        } else {
          console.log(`Total branch members: ${members.length}\n`);
          console.table(
            members.map((m) => ({
              Phone: m.phone,
              Branch: m.branch,
              Name: m.name || '-',
              Active: m.isActive,
              UpdatedAt: m.updatedAt ? m.updatedAt.toISOString() : '-',
            }))
          );
        }
        break;
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('Error running manageBranchMembers:', err);
  mongoose.disconnect().finally(() => process.exit(1));
});

