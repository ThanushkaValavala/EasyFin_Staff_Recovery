/**
 * NLP Summarizer — CommonJS port of the frontend deterministic mirror
 * Priority: PAID > PROMISED > REFUSED > UNAVAILABLE > GENERAL
 *
 * Case-insensitive, word-boundary/phrase-aware matching.
 * No network calls — all rules-based.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

function lc(t) { return (t || '').toLowerCase(); }

/**
 * Returns true if the text contains a negation immediately before `phrase`.
 * Negation words: not, no, never, didn't, did not, hasn't, haven't, won't, can't, unable
 */
function isNegated(text, phraseMatch) {
  // phraseMatch is a RegExpExecArray with .index
  const before = text.slice(0, phraseMatch.index);
  return /\b(not|no|never|didn'?t|did\s+not|hasn'?t|haven'?t|won'?t|can'?t|unable\s+to|has\s+not|have\s+not)\s*$/i.test(before);
}

// ── Classification rules ──────────────────────────────────────────────────────

/**
 * Determine if the remark contains a genuine PAID signal.
 * Rules:
 *   - Must contain a payment verb (paid, gave, collected, received, deposited, cleared, settled)
 *   - That verb must NOT be preceded by negation
 *   - "cash" alone does NOT count as PAID
 */
function isPaid(text) {
  const paymentVerbs = /\b(paid|gave|collected|received|deposited|cleared|settled)\b/gi;
  let m;
  while ((m = paymentVerbs.exec(text)) !== null) {
    if (!isNegated(text, m)) return true;
  }
  // "amount received", "payment received" phrases
  const phrases = [/\bamount\s+received\b/i, /\bpayment\s+received\b/i, /\bamount\s+paid\b/i];
  for (const p of phrases) {
    const pm = p.exec(text);
    if (pm && !isNegated(text, pm)) return true;
  }
  return false;
}

/**
 * Negation patterns that signal "not paid" even with payment words present.
 */
const NEGATED_PAYMENT = [
  /\bnot\s+paid\b/i,
  /\bdidn'?t\s+pay\b/i,
  /\bdid\s+not\s+pay\b/i,
  /\bno\s+payment\b/i,
  /\bhas\s+not\s+given\b/i,
  /\bhaven'?t\s+received\b/i,
  /\bunable\s+to\s+pay\b/i,
];

/**
 * Strong refusal patterns.
 * These take priority over weak PROMISED words.
 */
const REFUSAL_PATTERNS = [
  /\brefus(e|ed|ing|al)?\b/i,
  /\bwon'?t\s+pay\b/i,
  /\bno\s+money\b/i,
  /\bnot\s+willing\b/i,
  /\bdenied\b/i,
  /\bangry\b/i,
  /\baggressive\b/i,
];

/**
 * PROMISED patterns — includes "will give", "will give money", "promised", "told they will give",
 * "will arrange", "will bring", "next week", "tomorrow", "in N days", "after N days".
 */
const PROMISED_PATTERNS = [
  /\bpromise[sd]?\b/i,
  /\bwill\s+pay\b/i,
  /\bwill\s+give(\s+money)?\b/i,
  /\btold\s+(they|he|she)\s+will\s+give\b/i,
  /\bwill\s+arrange\b/i,
  /\bwill\s+bring\b/i,
  /\bwill\s+transfer\b/i,
  /\bpay\s+tomorrow\b/i,
  /\btomorrow\b/i,
  /\bnext\s+week\b/i,
  /\bnext\s+month\b/i,
  /\bin\s+\d+\s+days?\b/i,
  /\bafter\s+\d+\s+days?\b/i,
  /\bdeferred\b/i,
  /\bdefer\b/i,
  /\badditional\s+time\b/i,
  /\bmore\s+time\b/i,
];

/**
 * Weak PROMISED words — only count if no strong refusal is present.
 */
const WEAK_PROMISED_PATTERNS = [
  /\bsome\s+time\b/i,
  /\blater\b/i,
  /\bwait\b/i,
];

/** UNAVAILABLE patterns */
const UNAVAILABLE_PATTERNS = [
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
];

function matchesAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

function classify(text) {
  // Explicit negated-payment phrases short-circuit PAID
  const hasNegatedPayment = matchesAny(text, NEGATED_PAYMENT);

  if (!hasNegatedPayment && isPaid(text)) return 'PAID';

  const hasRefusal = matchesAny(text, REFUSAL_PATTERNS);
  const hasStrongPromise = matchesAny(text, PROMISED_PATTERNS);
  const hasWeakPromise = matchesAny(text, WEAK_PROMISED_PATTERNS);

  // Strong refusal beats weak promise words; but not strong promise words
  if (hasRefusal && !hasStrongPromise) return 'REFUSED';
  if (hasStrongPromise) return 'PROMISED';
  if (hasRefusal) return 'REFUSED'; // refusal + no promise
  if (hasWeakPromise) return 'PROMISED';
  if (matchesAny(text, UNAVAILABLE_PATTERNS)) return 'UNAVAILABLE';
  return 'GENERAL';
}

// ── Category metadata ──────────────────────────────────────────────────────────

const CATEGORY_META = {
  PAID:        { summary: 'Payment Collected Successfully',          badge: 'Green' },
  PROMISED:    { summary: 'Payment Promised - Follow-up Required',   badge: 'Amber' },
  REFUSED:     { summary: 'Customer Refused - Escalation Required',  badge: 'Red'   },
  UNAVAILABLE: { summary: 'Customer Unavailable - Revisit Required', badge: 'Red'   },
  GENERAL:     { summary: 'Customer Contacted - General Follow-up',  badge: 'Gray'  },
};

// ── extractDetails ────────────────────────────────────────────────────────────

/**
 * Words that look like names but are not.
 */
const NON_NAME_WORDS = new Set([
  'customer', 'house', 'home', 'money', 'today', 'tomorrow', 'family',
  'they', 'he', 'she', 'said', 'told', 'says', 'was', 'were', 'will',
  'is', 'paid', 'promised', 'not', 'came', 'but', 'then', 'and', 'or',
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'him', 'her', 'his', 'their', 'our', 'you', 'we', 'it', 'this',
  'that', 'some', 'no', 'yes', 'come', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'next', 'after', 'week',
  'month', 'days', 'day', 'time', 'rs', 'amount',
  'refused', 'refuse', 'waited', 'wait', 'call', 'pay', 'right', 'now',
  'cash', 'just', 'give', 'take', 'left', 'right', 'very', 'much',
]);

const STOP_WORDS = new Set([
  'they', 'he', 'she', 'said', 'told', 'says', 'was', 'were', 'will',
  'is', 'paid', 'promised', 'not', 'came', 'but', 'then',
  'refused', 'refuse', 'waited', 'call', 'pay',
]);

/** Capitalize first letter */
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

/** Returns true if token looks like a number */
function isNumericToken(t) { return /^\d+$/.test(t); }

/**
 * Extract a list of name tokens starting at position `start` in the token array.
 * Reads tokens joined by "and", "&", or commas until a stop word or number.
 */
function extractNameList(tokens, start) {
  const names = [];
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i].toLowerCase().replace(/[,.]$/, '');
    if (STOP_WORDS.has(tok) || isNumericToken(tok)) break;
    if (tok === 'and' || tok === '&' || tok === ',') { i++; continue; }
    if (!NON_NAME_WORDS.has(tok) && /^[a-z]+$/i.test(tok)) {
      names.push(cap(tok));
    } else {
      break;
    }
    i++;
  }
  return names;
}

/**
 * extractDetails(text) — rules-only, no network.
 * Returns { names, amounts, dates, phones, keyPoints }
 */
function extractDetails(text) {
  if (!text || typeof text !== 'string') {
    return { names: [], amounts: [], dates: [], phones: [], keyPoints: [] };
  }

  const t = text.trim();

  // ── PHONES ────────────────────────────────────────────────────────────────
  const phones = [];
  const phoneRe = /\b(\d{10})\b/g;
  let pm;
  const phoneSet = new Set();
  while ((pm = phoneRe.exec(t)) !== null) {
    if (!phoneSet.has(pm[1])) { phoneSet.add(pm[1]); phones.push(pm[1]); }
  }

  // ── AMOUNTS ───────────────────────────────────────────────────────────────
  // Strip phone numbers from text before amount extraction to avoid overlap
  const noPhones = t.replace(/\b\d{10}\b/g, '');
  const amounts = [];
  const amountSet = new Set();

  // Rs / ₹ with optional commas and k/thousand/lakh suffix
  const amtRe1 = /(?:Rs\.?\s*|₹\s*|rupees?\s+)(\d[\d,]*(?:\.\d+)?)\s*(?:thousand|lakh|k)?/gi;
  let am;
  while ((am = amtRe1.exec(noPhones)) !== null) {
    const raw = am[1].replace(/,/g, '');
    if (!amountSet.has(raw)) { amountSet.add(raw); amounts.push(formatAmount(am[0].trim())); }
  }

  // Plain numbers: 3+ digits, not a date fragment
  // Avoid dates: skip numbers that immediately follow "in", "after", "next", or are followed by "days"
  const plainNumRe = /\b(\d{3,})\b/g;
  while ((am = plainNumRe.exec(noPhones)) !== null) {
    const num = am[1];
    if (num.length === 10) continue; // already a phone
    // skip if next to "days"
    const after = noPhones.slice(am.index + num.length).match(/^\s*\w*/);
    if (after && /^days?$/i.test(after[0].trim())) continue;
    // skip if preceded by "in" or "after"
    const before = noPhones.slice(0, am.index).match(/\w+\s*$/);
    if (before && /^(in|after)$/i.test(before[0].trim())) continue;
    if (!amountSet.has(num)) { amountSet.add(num); amounts.push(`Rs ${Number(num).toLocaleString('en-IN')}`); }
  }

  // ── DATES ─────────────────────────────────────────────────────────────────
  const dates = [];
  const dateSet = new Set();
  function addDate(d) { if (!dateSet.has(d)) { dateSet.add(d); dates.push(d); } }

  if (/\btoday\b/i.test(t)) addDate('today');
  if (/\btomorrow\b/i.test(t)) addDate('tomorrow');
  if (/\bnext\s+week\b/i.test(t)) addDate('next week');
  if (/\bnext\s+month\b/i.test(t)) addDate('next month');
  if (/\bend\s+of\s+month\b/i.test(t)) addDate('end of month');

  const inDays = t.match(/\bin\s+(\d+)\s+days?\b/i);
  if (inDays) addDate(`in ${inDays[1]} days`);
  const afterDays = t.match(/\bafter\s+(\d+)\s+days?\b/i);
  if (afterDays) addDate(`after ${afterDays[1]} days`);
  const nDays = t.match(/\b(\d+)\s+days?\b/i);
  if (nDays && !inDays && !afterDays) addDate(`${nDays[1]} days`);

  // Weekday
  const weekdayM = t.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekdayM) addDate(cap(weekdayM[1]));

  // "on 15th" or ordinal
  const onDate = t.match(/\bon\s+(\d{1,2}(?:st|nd|rd|th)?)\b/i);
  if (onDate) addDate(`on ${onDate[1]}`);

  // dd/mm
  const ddmm = t.match(/\b(\d{1,2}\/\d{1,2})\b/);
  if (ddmm) addDate(ddmm[1]);

  // ── NAMES ─────────────────────────────────────────────────────────────────
  const names = [];
  const nameSet = new Set();
  function addNames(arr) {
    arr.forEach((n) => { if (!nameSet.has(n.toLowerCase())) { nameSet.add(n.toLowerCase()); names.push(n); } });
  }

  // Tokenize
  const tokens = t.split(/\s+/);

  // Triggers: words after which names follow
  const RELATION_WORDS = new Set(['wife', 'husband', 'son', 'daughter', 'brother', 'father', 'mother']);

  // Multi-word triggers scan
  const tLower = t.toLowerCase();
  const multiTriggers = ['spoke to', 'talked to'];
  for (const mt of multiTriggers) {
    let idx = tLower.indexOf(mt);
    while (idx !== -1) {
      const afterIdx = idx + mt.length;
      const afterText = t.slice(afterIdx).trim();
      const afterTokens = afterText.split(/\s+/);
      addNames(extractNameList(afterTokens, 0));
      idx = tLower.indexOf(mt, idx + 1);
    }
  }

  // Single-word triggers
  const singleTriggers = new Set(['met', 'meet', 'called', 'with', 'customer', 'mr', 'mrs', 'ms', 'shri', 'smt']);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].toLowerCase().replace(/[,.:;]$/, '');
    if (singleTriggers.has(tok)) {
      addNames(extractNameList(tokens, i + 1));
    }
    // Relation words: "wife said come" → "wife" is not a name but word after "wife" may be
    if (RELATION_WORDS.has(tok)) {
      // The relation word itself is not a name; skip to next token for a possible name
      // (e.g., "wife Sita said" — but we don't extract here unless there's another trigger)
    }
  }

  // ── KEY POINTS ────────────────────────────────────────────────────────────
  const keyPoints = [];

  if (/\b(paid|payment\s+received|amount\s+paid|amount\s+received)\b/i.test(t) &&
      !matchesAny(t, NEGATED_PAYMENT)) keyPoints.push('payment received');
  if (/\bpromis(e|ed)\b|will\s+pay|will\s+give|will\s+arrange|will\s+bring/i.test(t)) keyPoints.push('money promised');
  if (matchesAny(t, REFUSAL_PATTERNS)) keyPoints.push('refused to pay');
  if (matchesAny(t, UNAVAILABLE_PATTERNS)) keyPoints.push('not at home');
  if (/\bwaited\b/i.test(t)) keyPoints.push('waited for customer');
  if (phones.length > 0) keyPoints.push('phone number noted');

  return { names, amounts, dates, phones, keyPoints };
}

// ── Amount formatter helper ───────────────────────────────────────────────────

function formatAmount(raw) {
  // Extract the numeric part and format as Rs X,XX,XXX
  const numMatch = raw.match(/[\d,]+(?:\.\d+)?/);
  if (!numMatch) return raw;
  const digits = numMatch[0].replace(/,/g, '');
  const num = parseFloat(digits);
  if (isNaN(num)) return raw;
  // Check for suffix in original
  const lraw = raw.toLowerCase();
  let multiplied = num;
  if (lraw.includes('lakh')) multiplied = num * 100000;
  else if (lraw.includes('thousand') || lraw.endsWith('k')) multiplied = num * 1000;
  return `Rs ${Math.round(multiplied).toLocaleString('en-IN')}`;
}

// ── Build summary sentence ────────────────────────────────────────────────────

function buildSummary(text, category, details) {
  const { names, amounts, dates, phones, keyPoints } = details;

  // WHO
  let who = '';
  // Check for "spoke to" / "talked to"
  if (/spoke\s+to/i.test(text) && names.length > 0) {
    who = `Spoke to ${names.join(' and ')}`;
  } else if (/\b(met|meet)\b/i.test(text) && names.length > 0) {
    who = `Met ${names.join(' and ')}`;
  } else if (/\bcalled\b/i.test(text) && names.length > 0) {
    who = `Called ${names.join(' and ')}`;
  } else if (names.length > 0) {
    who = `Met ${names.join(' and ')}`;
  }

  // OUTCOME
  let outcome = '';
  if (category === 'PAID') {
    outcome = amounts.length > 0 ? 'paid' : 'paid';
  } else if (category === 'PROMISED') {
    outcome = 'money promised';
  } else if (category === 'REFUSED') {
    // Check for specific sub-reason
    if (/no\s+money/i.test(text)) outcome = 'refused to pay - says no money';
    else outcome = 'refused to pay';
  } else if (category === 'UNAVAILABLE') {
    outcome = 'not at home';
  } else {
    outcome = keyPoints[0] || '';
  }

  // AMOUNT
  const amountStr = amounts.length > 0 ? amounts[0] : '';

  // WHEN
  const whenStr = dates.length > 0 ? dates[0] : '';

  // ── Assemble sentence ─────────────────────────────────────────────────────
  let parts = [];

  if (who) parts.push(who);
  else if (category === 'REFUSED') parts.push('Customer');
  else if (category === 'UNAVAILABLE') parts.push('Customer');

  // Build main clause
  if (category === 'PAID') {
    // "Met X - Rs Y paid [when]"
    let clause = '';
    if (amountStr) clause = `${amountStr} paid`;
    else clause = 'paid';
    if (whenStr) clause += ` ${whenStr}`;
    if (who) {
      parts = [who, clause];
      return truncate(`${who} - ${clause}.`);
    } else {
      return truncate(`Payment received${amountStr ? ' ' + amountStr : ''}${whenStr ? ' ' + whenStr : ''}.`);
    }
  }

  if (category === 'PROMISED') {
    let clause = 'money promised';
    if (whenStr) clause += ` ${whenStr}`;
    let sentence = '';
    if (who) sentence = `${who} - ${clause}`;
    else sentence = `Payment promised${whenStr ? ' ' + whenStr : ''}`;
    if (phones.length > 0) sentence += `. Phone: ${phones[0]}`;
    return truncate(sentence + '.');
  }

  if (category === 'REFUSED') {
    let clause = outcome;
    if (who) return truncate(`${who} - ${clause}.`);
    return truncate(`Customer ${clause}.`);
  }

  if (category === 'UNAVAILABLE') {
    if (who) return truncate(`${who} - not at home.`);
    return truncate('Customer not at home.');
  }

  // GENERAL
  if (keyPoints.length > 0) {
    if (who) return truncate(`${who} - ${keyPoints[0]}.`);
    return truncate(`${keyPoints[0].charAt(0).toUpperCase() + keyPoints[0].slice(1)}.`);
  }
  if (who) return truncate(`${who} - visit recorded.`);
  return CATEGORY_META['GENERAL'].summary;
}

function truncate(s, max = 200) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── RULES (kept for backward compatibility export) ────────────────────────────

const RULES = [
  {
    category: 'PAID',
    summary: CATEGORY_META.PAID.summary,
    badge: CATEGORY_META.PAID.badge,
    patterns: [
      /\bpaid\b/i,
      /\bcollected\b/i,
      /\bamount\s+received\b/i,
      /\bpayment\s+received\b/i,
      /\bamount\s+paid\b/i,
    ],
  },
  {
    category: 'PROMISED',
    summary: CATEGORY_META.PROMISED.summary,
    badge: CATEGORY_META.PROMISED.badge,
    patterns: PROMISED_PATTERNS,
  },
  {
    category: 'REFUSED',
    summary: CATEGORY_META.REFUSED.summary,
    badge: CATEGORY_META.REFUSED.badge,
    patterns: REFUSAL_PATTERNS,
  },
  {
    category: 'UNAVAILABLE',
    summary: CATEGORY_META.UNAVAILABLE.summary,
    badge: CATEGORY_META.UNAVAILABLE.badge,
    patterns: UNAVAILABLE_PATTERNS,
  },
];

const DEFAULT_RESULT = {
  category: 'GENERAL',
  summary: CATEGORY_META.GENERAL.summary,
  badge: CATEGORY_META.GENERAL.badge,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Summarize customer visit remarks according to strict priority order.
 *
 * @param {string} remark
 * @returns {{ nlpSummary: string, nlpCategory: string, nlpDetails: object }}
 */
function summarize(remark) {
  const fallback = {
    nlpSummary: CATEGORY_META['GENERAL'].summary,
    nlpCategory: 'GENERAL',
    nlpDetails: { names: [], amounts: [], dates: [], phones: [], keyPoints: [] },
  };

  if (!remark || typeof remark !== 'string') return fallback;
  const clean = remark.trim();
  if (!clean) return fallback;

  try {
    const category = classify(clean);
    const details = extractDetails(clean);
    const nlpSummary = buildSummary(clean, category, details) || CATEGORY_META[category].summary;

    return {
      nlpSummary,
      nlpCategory: category,
      nlpDetails: details,
    };
  } catch (err) {
    // Never block saving
    return {
      nlpSummary: CATEGORY_META['GENERAL'].summary,
      nlpCategory: 'GENERAL',
      nlpDetails: { names: [], amounts: [], dates: [], phones: [], keyPoints: [] },
    };
  }
}

module.exports = {
  summarize,
  extractDetails,
  RULES,
  DEFAULT_RESULT,
};
