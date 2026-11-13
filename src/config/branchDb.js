require('dotenv').config();
const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const OtpRecord = require('../models/OtpRecord');
const BranchMember = require('../models/BranchMember');
const RecoverySession = require('../models/RecoverySession');
const Evidence = require('../models/Evidence');
const TrackingPoint = require('../models/TrackingPoint');
const StopEvent = require('../models/StopEvent');
const Assignment = require('../models/Assignment');
const Customer = require('../models/Customer');
const Loan = require('../models/Loan');
const RecoveryReport = require('../models/RecoveryReport');

let connBranch1 = null;
let connBranch2 = null;

let modelsBranch1 = null;
let modelsBranch2 = null;

function registerBranchModels(conn) {
  const staffModel = conn.models.Staff || conn.model('Staff', Staff.schema, 'users');
  if (!conn.models.User) {
    conn.model('User', Staff.schema, 'users');
  }
  const otpRecordModel = conn.models.OtpRecord || conn.model('OtpRecord', OtpRecord.schema);
  const branchMemberModel = conn.models.BranchMember || conn.model('BranchMember', BranchMember.schema);
  const recoverySessionModel = conn.models.RecoverySession || conn.model('RecoverySession', RecoverySession.schema);
  const evidenceModel = conn.models.Evidence || conn.model('Evidence', Evidence.schema);
  const trackingPointModel = conn.models.TrackingPoint || conn.model('TrackingPoint', TrackingPoint.schema);
  const stopEventModel = conn.models.StopEvent || conn.model('StopEvent', StopEvent.schema);
  const assignmentModel = conn.models.Assignment || conn.model('Assignment', Assignment.schema);
  const customerModel = conn.models.Customer || conn.model('Customer', Customer.schema);
  const loanModel = conn.models.Loan || conn.model('Loan', Loan.schema);
  const recoveryReportModel = conn.models.RecoveryReport || conn.model('RecoveryReport', RecoveryReport.schema);

  return {
    Staff: staffModel,
    OtpRecord: otpRecordModel,
    BranchMember: branchMemberModel,
    RecoverySession: recoverySessionModel,
    Evidence: evidenceModel,
    TrackingPoint: trackingPointModel,
    StopEvent: stopEventModel,
    Assignment: assignmentModel,
    Customer: customerModel,
    Loan: loanModel,
    RecoveryReport: recoveryReportModel,
  };
}

function initBranch1() {
  if (!connBranch1) {
    const uri = process.env.MONGODB_URI_BRANCH1 || '';
    connBranch1 = mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 7000,
    });
    modelsBranch1 = registerBranchModels(connBranch1);
  }
}

function initBranch2() {
  if (!connBranch2) {
    const uri = process.env.MONGODB_URI_BRANCH2 || '';
    connBranch2 = mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 7000,
    });
    modelsBranch2 = registerBranchModels(connBranch2);
  }
}

async function connectBranchDbs() {
  initBranch1();
  initBranch2();

  const connectOne = async (branchName, conn) => {
    try {
      await conn.asPromise();
      console.log(`[${branchName} DB] Connected to database: ${conn.host}/${conn.name}`);
      try {
        await conn.db.createCollection('assignments');
      } catch (colErr) {
        const isAlreadyExists =
          colErr.code === 48 ||
          colErr.codeName === 'NamespaceExists' ||
          (colErr.message && colErr.message.includes('already exists'));
        if (!isAlreadyExists) {
          console.error(`[${branchName} DB] Warning creating assignments collection:`, colErr.message);
        }
      }
    } catch (err) {
      console.error(`[${branchName} DB Error] Failed to connect: ${err.message}`);
    }
  };

  await Promise.all([
    connectOne('Branch 1', connBranch1),
    connectOne('Branch 2', connBranch2),
  ]);

  return { connBranch1, connBranch2 };
}

function getModels(branch) {
  if (branch === 'Branch 1') {
    if (!modelsBranch1) {
      initBranch1();
    }
    return modelsBranch1;
  }
  if (branch === 'Branch 2') {
    if (!modelsBranch2) {
      initBranch2();
    }
    return modelsBranch2;
  }
  return null;
}

function isBranchDbConnected(branch) {
  if (branch === 'Branch 1') {
    return Boolean(connBranch1 && connBranch1.readyState === 1);
  }
  if (branch === 'Branch 2') {
    return Boolean(connBranch2 && connBranch2.readyState === 1);
  }
  return false;
}

module.exports = {
  connectBranchDbs,
  getModels,
  isBranchDbConnected,
};

