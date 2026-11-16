require('dotenv').config();
const mongoose = require('mongoose');
const apply = process.argv.includes('--apply');
const last10 = p => String(p || '').replace(/\D/g, '').slice(-10);

const SUMMARY = {
  PAID: 'Repayment Collected Successfully',
  PROMISED: 'Repayment Commitment Recorded — Follow-up Required',
  REFUSED: 'Repayment Refusal Recorded — Escalation Required',
  UNAVAILABLE: 'Borrower Unavailable — Follow-up Visit Required',
  GENERAL: 'Borrower Contact Recorded — General Account Follow-up',
};
const fromOutcome = o => {
  const x = String(o || '').toUpperCase();
  if (/COLLECT|PAID|PARTIAL/.test(x)) return 'PAID';
  if (/PROMIS/.test(x)) return 'PROMISED';
  if (/REFUS|DECLIN/.test(x)) return 'REFUSED';
  if (/UNAVAIL|ABSENT|NOT_AVAIL/.test(x)) return 'UNAVAILABLE';
  return 'GENERAL';
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const idToPhone = new Map();   // agent _id -> last 10 digits
  const rows = new Map();        // last 10 digits -> row
  const addPerson = d => {
    const p = last10(d.phone);
    if (!p) return;
    idToPhone.set(String(d._id), p);
    if (!rows.has(p)) rows.set(p, { mobile: p, recoveries: 0, totalMeters: 0, counts: {}, latestAt: null, latestSummary: null });
  };
  for (const s of await db.collection('staffs').find({}).toArray()) addPerson(s);
  for (const u of await db.collection('users').find({}).toArray()) addPerson(u);

  for await (const r of db.collection('recoverysessions').find({ status: 'COMPLETED' })) {
    const p = idToPhone.get(String(r.agentId || r.staffId || ''));
    if (!p) continue;
    const row = rows.get(p);
    row.recoveries++;
    row.totalMeters += Number(r.distanceMeters) || 0;
    const cat = SUMMARY[r.nlpCategory] ? r.nlpCategory : fromOutcome(r.outcome);
    const text = SUMMARY[cat];
    row.counts[text] = (row.counts[text] || 0) + 1;
    const when = r.endTime || r.createdAt;
    if (!row.latestAt || when > row.latestAt) { row.latestAt = when; row.latestSummary = text; }
  }

  const out = [...rows.values()]
    .map(r => ({
      mobile: r.mobile,
      recoveries: r.recoveries,
      totalKm: Math.round(r.totalMeters / 10) / 100,
      latestNlpSummary: r.latestSummary || '-',
      nlpSummaryCounts: r.counts,
      updatedAt: new Date(),
    }))
    .sort((a, b) => b.recoveries - a.recoveries);

  console.table(out.map(o => ({ mobile: o.mobile, recoveries: o.recoveries, km: o.totalKm, latestNlp: o.latestNlpSummary })));

  if (apply) {
    const col = db.collection('agent_history_summary');
    await col.deleteMany({});   // rebuild this summary table from scratch
    if (out.length) await col.insertMany(out);
    await col.createIndex({ mobile: 1 }, { unique: true });
    console.log('Saved', out.length, 'rows to agent_history_summary');
  } else {
    console.log('DRY RUN: nothing saved. Add --apply to save.');
  }
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
