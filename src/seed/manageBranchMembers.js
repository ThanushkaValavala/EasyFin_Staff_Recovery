require('dotenv').config();
const { connectBranchDbs, getModels, isBranchDbConnected } = require('../config/branchDb');

const ALLOWED_BRANCHES = ['Branch 1', 'Branch 2'];

function printUsage() {
  console.log(`
Usage:
  node src/seed/manageBranchMembers.js "<Branch 1|Branch 2>" add <phone> "<name>"
  node src/seed/manageBranchMembers.js "<Branch 1|Branch 2>" move <phone>
  node src/seed/manageBranchMembers.js "<Branch 1|Branch 2>" deactivate <phone>
  node src/seed/manageBranchMembers.js "<Branch 1|Branch 2>" activate <phone>
  node src/seed/manageBranchMembers.js "<Branch 1|Branch 2>" list
`);
}

async function run() {
  const rawArgs = process.argv.slice(2);

  let branch = null;
  let action = null;
  let args = [];

  if (ALLOWED_BRANCHES.includes(rawArgs[0])) {
    branch = rawArgs[0];
    action = rawArgs[1];
    args = rawArgs.slice(2);
  } else {
    // Check if branch was passed elsewhere in args
    const foundBranch = rawArgs.find(a => ALLOWED_BRANCHES.includes(a));
    if (foundBranch) {
      branch = foundBranch;
      const filtered = rawArgs.filter(a => a !== foundBranch);
      action = filtered[0];
      args = filtered.slice(1);
    } else {
      action = rawArgs[0];
      args = rawArgs.slice(1);
    }
  }

  if (!branch || !ALLOWED_BRANCHES.includes(branch)) {
    console.error('Error: A valid branch argument ("Branch 1" or "Branch 2") is required.');
    printUsage();
    process.exit(1);
  }

  if (!action || !['add', 'move', 'deactivate', 'activate', 'list'].includes(action)) {
    printUsage();
    process.exit(1);
  }

  await connectBranchDbs();

  if (!isBranchDbConnected(branch)) {
    console.error(`Error: Could not connect to database for ${branch}`);
    process.exit(1);
  }

  const models = getModels(branch);
  const BranchMember = models.BranchMember;

  try {
    switch (action) {
      case 'add': {
        const [rawPhone, name = ''] = args;
        if (!rawPhone) {
          console.error('Error: <phone> is required for "add".');
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

        console.log(`Successfully added / updated branch member in ${branch}:`);
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
        const [rawPhone] = args;
        if (!rawPhone) {
          console.error('Error: <phone> is required for "move".');
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

        const member = await BranchMember.findOneAndUpdate(
          { phone },
          { $set: { branch } },
          { new: true }
        );

        if (!member) {
          console.error(`Member with phone ${phone} not found in ${branch}.`);
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
          console.error(`Member with phone ${phone} not found in ${branch}.`);
          process.exitCode = 1;
        } else {
          console.log(`Successfully deactivated member ${phone} in ${branch}:`);
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
          console.error(`Member with phone ${phone} not found in ${branch}.`);
          process.exitCode = 1;
        } else {
          console.log(`Successfully activated member ${phone} in ${branch}:`);
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
        const members = await BranchMember.find({}).sort({ phone: 1 }).lean();
        if (members.length === 0) {
          console.log(`No branch members found in ${branch} database.`);
        } else {
          console.log(`Total branch members in ${branch}: ${members.length}\n`);
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
    process.exit(process.exitCode || 0);
  }
}

run().catch((err) => {
  console.error('Error running manageBranchMembers:', err);
  process.exit(1);
});
