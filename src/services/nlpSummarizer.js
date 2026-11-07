/**
 * NLP Summarizer — Backend (authoritative)
 * Priority order: PAID > PROMISED > REFUSED > UNAVAILABLE > GENERAL
 * Case-insensitive keyword matching. First match wins.
 */

const RULES = [
  // PRIORITY 1 – PAID
  {
    keywords: ['paid', 'collected', 'cash', 'amount received', 'payment received', 'amount paid'],
    summary: 'Payment Collected Successfully',
    category: 'PAID',
  },
  // PRIORITY 2 – PROMISED
  {
    keywords: ['promise', 'will pay', 'pay tomorrow', 'later', 'next week', 'tomorrow', 'next month', 'will transfer'],
    summary: 'Payment Promised - Follow-up Required',
    category: 'PROMISED',
  },
  // PRIORITY 3 – REFUSED
  {
    keywords: ['refuse', 'refused', 'not willing', 'angry', "won't pay", 'wont pay', 'denied', 'aggressive'],
    summary: 'Customer Refused - Escalation Required',
    category: 'REFUSED',
  },
  // PRIORITY 4 – UNAVAILABLE
  {
    keywords: ['not there', 'not available', 'absent', 'not home', 'not at home', 'not found', 'nobody home', 'door locked', 'locked'],
    summary: 'Customer Unavailable - Revisit Required',
    category: 'UNAVAILABLE',
  },
];

const DEFAULT = {
  summary: 'Customer Contacted - General Follow-up',
  category: 'GENERAL',
};

/**
 * @param {string} remark
 * @returns {{ nlpSummary: string, nlpCategory: string }}
 */
function summarize(remark) {
  if (!remark || typeof remark !== 'string') {
    return { nlpSummary: DEFAULT.summary, nlpCategory: DEFAULT.category };
  }

  const lower = remark.toLowerCase();

  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return { nlpSummary: rule.summary, nlpCategory: rule.category };
    }
  }

  return { nlpSummary: DEFAULT.summary, nlpCategory: DEFAULT.category };
}

module.exports = { summarize };
