/**
 * NLP Summarizer — Frontend mirror
 * Priority order: PAID > PROMISED > REFUSED > UNAVAILABLE > GENERAL
 * Must stay in sync with backend src/services/nlpSummarizer.js
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
export function summarize(remark) {
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

export const BADGE_COLORS = {
  PAID:        { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' },
  PROMISED:    { bg: '#FEF9C3', text: '#A16207', border: '#FDE047' },
  REFUSED:     { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
  UNAVAILABLE: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
  GENERAL:     { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
};
