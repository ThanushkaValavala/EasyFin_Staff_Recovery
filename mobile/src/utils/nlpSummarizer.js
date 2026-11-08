/**
 * NLP Summarizer — Frontend deterministic mirror
 * Priority: PAID > PROMISED > REFUSED > UNAVAILABLE > GENERAL
 *
 * Case-insensitive, word-boundary/phrase-aware matching.
 */

const RULES = [
  // PRIORITY 1 – PAID
  {
    category: 'PAID',
    summary: 'Payment Collected Successfully',
    badge: 'Green',
    patterns: [
      /\bpaid\b/i,
      /\bcollected\b/i,
      /\bcash\b/i,
      /\bamount\s+received\b/i,
      /\bpayment\s+received\b/i,
      /\bamount\s+paid\b/i,
    ],
  },
  // PRIORITY 2 – PROMISED
  {
    category: 'PROMISED',
    summary: 'Payment Promised - Follow-up Required',
    badge: 'Amber',
    patterns: [
      /\bpromise[sd]?\b/i,
      /\bwill\s+pay\b/i,
      /\bpay\s+tomorrow\b/i,
      /\blater\b/i,
      /\bnext\s+week\b/i,
      /\btomorrow\b/i,
      /\bnext\s+month\b/i,
      /\bwill\s+transfer\b/i,
      /\bdeferred\b/i,
      /\bdefer\b/i,
      /\badditional\s+time\b/i,
      /\bmore\s+time\b/i,
      /\bsome\s+time\b/i,
      /\bwait\b/i,
    ],
  },
  // PRIORITY 3 – REFUSED
  {
    category: 'REFUSED',
    summary: 'Customer Refused - Escalation Required',
    badge: 'Red',
    patterns: [
      /\brefus(e|ed|ing|al)?\b/i,
      /\bnot\s+willing\b/i,
      /\bangry\b/i,
      /\bdenied\b/i,
      /\bwon'?t\s+pay\b/i,
      /\baggressive\b/i,
    ],
  },
  // PRIORITY 4 – UNAVAILABLE
  {
    category: 'UNAVAILABLE',
    summary: 'Customer Unavailable - Revisit Required',
    badge: 'Red',
    patterns: [
      /\bnot\s+there\b/i,
      /\bnot\s+available\b/i,
      /\babsent\b/i,
      /\bnot\s+(at\s+)?home\b/i,
      /\bdoor\s+locked\b/i,
      /\blocked\b/i,
      /\bnot\s+found\b/i,
      /\bnobody\s+(was\s+)?home\b/i,
      /\bno\s+one\s+(was\s+)?home\b/i,
      /\bno\s+one\s+at\s+home\b/i,
      /\bhouse\s+locked\b/i,
    ],
  },
];

const DEFAULT_RESULT = {
  category: 'GENERAL',
  summary: 'Customer Contacted - General Follow-up',
  badge: 'Gray',
};

export const BADGE_COLORS = {
  PAID: { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' },
  PROMISED: { bg: '#FEF9C3', text: '#A16207', border: '#FDE047' },
  REFUSED: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
  UNAVAILABLE: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
  GENERAL: { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
};

/**
 * Summarize customer visit remarks according to strict priority order.
 *
 * @param {string} remark
 * @returns {{ nlpSummary: string, nlpCategory: string }}
 */
export function summarize(remark) {
  if (!remark || typeof remark !== 'string') {
    return {
      nlpSummary: DEFAULT_RESULT.summary,
      nlpCategory: DEFAULT_RESULT.category,
    };
  }

  const clean = remark.trim();
  if (!clean) {
    return {
      nlpSummary: DEFAULT_RESULT.summary,
      nlpCategory: DEFAULT_RESULT.category,
    };
  }

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(clean)) {
        return {
          nlpSummary: rule.summary,
          nlpCategory: rule.category,
        };
      }
    }
  }

  return {
    nlpSummary: DEFAULT_RESULT.summary,
    nlpCategory: DEFAULT_RESULT.category,
  };
}
