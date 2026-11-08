/**
 * NLP Summarizer — Deterministic Rule-Based Classifier
 * Priority: PAID > PROMISED > REFUSED > UNAVAILABLE > GENERAL
 *
 * Case-insensitive, word-boundary/phrase-aware matching to prevent
 * accidental substring matches inside unrelated words.
 */

const RULES = [
  // PRIORITY 1 – PAID
  {
    category: 'PAID',
    summary: 'Payment Collected Successfully',
    badge: 'Green',
    // Keywords: paid, collected, cash, amount received
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
    // Keywords: promise, will pay, pay tomorrow, later, next week, deferred, additional time
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
    // Keywords: refuse, not willing, angry, denied
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
    // Keywords: not there, not available, absent, not at home, locked
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

/**
 * Summarize customer visit remarks according to strict priority order.
 *
 * @param {string} remark - Raw customer remarks text
 * @returns {{ nlpSummary: string, nlpCategory: string }}
 */
function summarize(remark) {
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

  // Evaluate each rule strictly by priority
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

module.exports = {
  summarize,
  RULES,
  DEFAULT_RESULT,
};
