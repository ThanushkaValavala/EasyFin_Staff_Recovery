/**
 * NLP Summarizer — Frontend deterministic mirror
 * Rules-based only, no network.
 * Priority: PAID > PROMISED > REFUSED > UNAVAILABLE > GENERAL
 *
 * Case-insensitive, word-boundary/phrase-aware matching.
 * No network calls — all rules-based.
 */

// ── Text Cleaning ──────────────────────────────────────────────────────────────

function cleanText(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text;
  // shortcuts
  t = t.replace(/\bcstmr\b/gi, 'customer');
  t = t.replace(/\bhme\b/gi, 'home');
  t = t.replace(/\bdr\b/gi, 'door');
  t = t.replace(/\btmrw\b/gi, 'tomorrow');
  t = t.replace(/\btomorow\b/gi, 'tomorrow');
  t = t.replace(/\bplz\b/gi, 'please');
  // contractions with or without apostrophe (order matters: longer first)
  // Handle both straight (') and curly (\u2019) apostrophes
  t = t.replace(/\bdon[\u2019']?t\b/gi, 'do not');
  t = t.replace(/\bdoesn[\u2019']?t\b/gi, 'does not');
  t = t.replace(/\bdidn[\u2019']?t\b/gi, 'did not');
  t = t.replace(/\bcan[\u2019']?t\b/gi, 'can not');
  t = t.replace(/\bwon[\u2019']?t\b/gi, 'will not');
  t = t.replace(/\bhaven[\u2019']?t\b/gi, 'have not');
  t = t.replace(/\bhasn[\u2019']?t\b/gi, 'has not');
  // Replace ... first (before single dot)
  t = t.replace(/\.\.\./g, ' ');
  // Preserve decimal numbers before stripping punctuation: replace decimal point in numbers with placeholder
  t = t.replace(/(\d)\.(\d)/g, '$1\x00$2');
  // Replace punctuation touching words with space
  t = t.replace(/[.,;:\-]+/g, ' ');
  // Restore decimal points
  t = t.replace(/\x00/g, '.');
  // collapse spaces
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function lc(s) { return (s || '').toLowerCase(); }

function cap(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function truncate(s, max = 200) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function matchesAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

// ── Amount Parsing & Formatting ───────────────────────────────────────────────

/**
 * Parse a raw number string with optional suffix (k, thousand, lakh) to an integer.
 */
function parseAmountValue(numStr, suffix) {
  const n = parseFloat(numStr.replace(/,/g, ''));
  if (isNaN(n)) return null;
  const s = (suffix || '').toLowerCase().trim();
  if (s === 'lakh' || s === 'lakhs') return Math.round(n * 100000);
  if (s === 'k' || s === 'thousand') return Math.round(n * 1000);
  return Math.round(n);
}

function formatRs(value) {
  return `Rs ${Number(value).toLocaleString('en-IN')}`;
}

// ── Phone Extraction ──────────────────────────────────────────────────────────

/**
 * Extract 10-digit phone numbers from ORIGINAL text (before cleaning removes hyphens/spaces).
 * A 10-digit number immediately followed by a currency marker is an amount, not a phone.
 */
function extractPhones(originalText) {
  const phones = [];
  const phoneSet = new Set();
  // Match solid 10-digit or 5+5 (space or hyphen separated)
  const re = /\b(\d{5})[\s-](\d{5})\b|\b(\d{10})\b/g;
  let m;
  while ((m = re.exec(originalText)) !== null) {
    const digits = m[1] ? (m[1] + m[2]) : m[3];
    if (digits.length !== 10) continue;
    // Check if immediately followed by a currency marker → it's an amount
    const afterIdx = m.index + m[0].length;
    const afterStr = originalText.slice(afterIdx).replace(/^\s*/, '');
    if (/^(rs|rupees|₹)/i.test(afterStr)) continue;
    if (!phoneSet.has(digits)) {
      phoneSet.add(digits);
      phones.push(digits);
    }
  }
  return phones;
}

// ── Amount Extraction ─────────────────────────────────────────────────────────

/**
 * Extract all monetary amounts from cleaned text.
 * Returns array of { raw: string, value: number } in order of appearance.
 * Skips 10-digit numbers (phones) already captured.
 */
function extractAmounts(cleanedText, phones) {
  const phoneSet = new Set(phones);
  const amounts = [];
  const amountPositions = []; // track char positions to avoid double-counting

  function addAmount(value, start, end) {
    // Check overlap
    for (const [s, e] of amountPositions) {
      if (start < e && end > s) return; // overlap
    }
    amountPositions.push([start, end]);
    amounts.push({ value, raw: formatRs(value) });
  }

  // 1. Currency prefix: Rs / ₹ / rupees followed by number with optional suffix
  const re1 = /(?:Rs\.?\s*|₹\s*|rupees?\s+)(\d[\d,]*)(?:\s*(lakh|lakhs|thousand|k))?\b/gi;
  let m;
  while ((m = re1.exec(cleanedText)) !== null) {
    const v = parseAmountValue(m[1], m[2]);
    if (v !== null && v > 0) addAmount(v, m.index, m.index + m[0].length);
  }

  // 2. Number with suffix: 2k, 1.5lakh (no space needed), 2 lakh
  const re2 = /\b(\d+(?:\.\d+)?)\s*(lakh|lakhs|thousand|k)\b/gi;
  while ((m = re2.exec(cleanedText)) !== null) {
    const v = parseAmountValue(m[1], m[2]);
    if (v !== null && v > 0) addAmount(v, m.index, m.index + m[0].length);
  }

  // 3. Plain 3+ digit numbers not already captured
  const re3 = /\b(\d{3,})\b/g;
  while ((m = re3.exec(cleanedText)) !== null) {
    const digits = m[1];
    if (digits.length === 10 && phoneSet.has(digits)) continue;
    if (digits.length === 10) continue; // treat 10-digit as phone candidate
    // Skip if followed by time units (minutes, hours, seconds)
    const after = cleanedText.slice(m.index + digits.length).match(/^\s*(\w+)/);
    if (after && /^(minutes?|hours?|seconds?|mins?)$/i.test(after[1])) continue;
    // Skip if preceded by "in" or "after" (date context like "in 2 days") — but those are <3 digit usually
    const before = cleanedText.slice(0, m.index).match(/\b(\w+)\s*$/);
    if (before && /^(in|after)$/i.test(before[1])) continue;
    // Skip if followed by "days"
    if (after && /^days?$/i.test(after[1])) continue;
    const v = parseInt(digits, 10);
    if (v > 0) addAmount(v, m.index, m.index + m[0].length);
  }

  return amounts;
}

// ── Date Extraction ───────────────────────────────────────────────────────────

function extractDates(cleanedText) {
  const dates = [];
  const dateSet = new Set();
  function add(d) { if (!dateSet.has(d)) { dateSet.add(d); dates.push(d); } }

  if (/\btoday\b/i.test(cleanedText)) add('today');
  if (/\btomorrow\b/i.test(cleanedText)) add('tomorrow');
  if (/\bnext\s+week\b/i.test(cleanedText)) add('next week');
  if (/\bnext\s+month\b/i.test(cleanedText)) add('next month');
  if (/\bend\s+of\s+month\b/i.test(cleanedText)) add('end of month');

  const inDays = cleanedText.match(/\bin\s+(\d+)\s+days?\b/i);
  if (inDays) add(`in ${inDays[1]} days`);
  const afterDays = cleanedText.match(/\bafter\s+(\d+)\s+days?\b/i);
  if (afterDays) add(`after ${afterDays[1]} days`);

  const weekday = cleanedText.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) add(cap(weekday[1]));

  const onDate = cleanedText.match(/\bon\s+(\d{1,2}(?:st|nd|rd|th)?)\b/i);
  if (onDate) add(`on ${onDate[1]}`);

  const ddmm = cleanedText.match(/\b(\d{1,2}\/\d{1,2})\b/);
  if (ddmm) add(ddmm[1]);

  return dates;
}

// ── Name Extraction ────────────────────────────────────────────────────────────

const NON_NAME_WORDS = new Set([
  'him', 'her', 'them', 'customer', 'house', 'home', 'money', 'today', 'tomorrow',
  'family', 'rude', 'refused', 'waited', 'visited', 'paid', 'cash',
  // also general stop words / grammar words
  'they', 'he', 'she', 'said', 'told', 'says', 'was', 'were', 'will',
  'is', 'promised', 'not', 'came', 'but', 'then', 'asked', 'do', 'does', 'did',
  'and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'his', 'their', 'our', 'you', 'we', 'it', 'this', 'that', 'some', 'no', 'yes',
  'come', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'next', 'after', 'week', 'month', 'days', 'day', 'time', 'rs', 'amount',
  'refuse', 'wait', 'call', 'pay', 'right', 'now', 'just', 'give', 'take',
  'left', 'very', 'much', 'any', 'has', 'have', 'had', 'been', 'be', 'are',
  'up', 'out', 'if', 'so', 'us', 'me', 'my', 'your', 'its', 'got', 'get',
  'cant', 'dont', 'wont', 'havent', 'hasnt', 'can', 'number', 'door',
  'balance', 'please', 'back', 'later', 'more', 'come', 'came', 'go', 'went',
  'meet', 'met', 'spoke', 'talked', 'called', 'visit', 'visited',
]);

// Stop the name-reading loop
const STOP_WORDS_SET = new Set([
  'he', 'she', 'they', 'said', 'told', 'says', 'was', 'were', 'will', 'is',
  'paid', 'promised', 'not', 'came', 'but', 'then', 'asked', 'dont', 'cant', 'can',
  'do', 'does', 'did', 'has', 'have', 'had',
]);

const RELATION_WORDS = new Set(['wife', 'husband', 'son', 'daughter', 'brother', 'father', 'mother']);
const TITLE_WORDS = new Set(['mr', 'mrs', 'ms', 'shri', 'smt']);

/**
 * Check if a token is a valid name candidate.
 */
function isValidName(tok) {
  if (!tok) return false;
  const t = tok.toLowerCase();
  if (STOP_WORDS_SET.has(t)) return false;
  if (NON_NAME_WORDS.has(t)) return false;
  if (TITLE_WORDS.has(t)) return false;
  if (RELATION_WORDS.has(t)) return false;
  if (!/^[a-z]+$/i.test(t)) return false; // must be alpha only
  return true;
}

/**
 * Extract names from a token array starting at `start`.
 * Reads list items separated by "and", "&", commas.
 * Handles title words (mr/mrs/...) by skipping them and grabbing the next token.
 */
function readNameList(tokens, start) {
  const names = [];
  let i = start;
  while (i < tokens.length) {
    const rawTok = tokens[i].replace(/[,.:;]+$/, '');
    const tok = rawTok.toLowerCase();

    if (STOP_WORDS_SET.has(tok)) break;
    if (tok === 'and' || tok === '&') { i++; continue; }
    if (tok === '' || tok === ',') { i++; continue; }

    // If it's a title word, skip it and grab the next token as name
    if (TITLE_WORDS.has(tok)) {
      i++;
      if (i < tokens.length) {
        const nextRaw = tokens[i].replace(/[,.:;]+$/, '');
        const nextTok = nextRaw.toLowerCase();
        if (isValidName(nextTok)) {
          names.push(cap(nextRaw));
        }
      }
      i++;
      continue;
    }

    // Pronoun-like words stop regular name reading but don't stop relation-word scanning
    if (NON_NAME_WORDS.has(tok) && !RELATION_WORDS.has(tok)) break;

    // Relation word: skip it, grab the word after as name
    if (RELATION_WORDS.has(tok)) {
      i++;
      if (i < tokens.length) {
        const nextRaw = tokens[i].replace(/[,.:;]+$/, '');
        const nextTok = nextRaw.toLowerCase();
        // Skip pronoun-like words before the relation trigger result
        if (nextTok === 'his' || nextTok === 'her' || nextTok === 'their') { i++; continue; }
        if (isValidName(nextTok)) {
          names.push(cap(nextRaw));
        }
      }
      i++;
      continue;
    }

    if (isValidName(tok)) {
      names.push(cap(rawTok));
      i++;
    } else {
      break;
    }
  }
  return names;
}

/**
 * Full name extraction from text using trigger words.
 */
function extractNames(cleanedText) {
  const names = [];
  const nameSet = new Set();

  function addNames(arr) {
    for (const n of arr) {
      const key = n.toLowerCase();
      if (!nameSet.has(key)) {
        nameSet.add(key);
        names.push(n);
      }
    }
  }

  const tokens = cleanedText.split(/\s+/).filter(Boolean);
  const tl = cleanedText.toLowerCase();

  // Scan for multi-word triggers first (spoke to, talked to)
  const multiTriggers = [
    { phrase: 'spoke to', label: 'spoke' },
    { phrase: 'talked to', label: 'talked' },
  ];

  for (const { phrase } of multiTriggers) {
    let idx = tl.indexOf(phrase);
    while (idx !== -1) {
      // Find position in token array after the trigger
      const afterText = cleanedText.slice(idx + phrase.length).trimStart();
      const afterTokens = afterText.split(/\s+/).filter(Boolean);
      addNames(readNameList(afterTokens, 0));
      idx = tl.indexOf(phrase, idx + 1);
    }
  }

  // Single-word triggers
  for (let i = 0; i < tokens.length; i++) {
    const rawTok = tokens[i].replace(/[,.:;]+$/, '');
    const tok = rawTok.toLowerCase();

    if (tok === 'met' || tok === 'meet') {
      addNames(readNameList(tokens, i + 1));
      continue;
    }

    if (tok === 'called') {
      // "called" followed by a person name (not "call him on...")
      addNames(readNameList(tokens, i + 1));
      continue;
    }

    // "visited" only when followed directly by a person's name (not intransitive)
    if (tok === 'visited') {
      const nextRaw = i + 1 < tokens.length ? tokens[i + 1].replace(/[,.:;]+$/, '') : '';
      const nextTok = nextRaw.toLowerCase();
      // If next token is a valid name (not "paid", not punctuation-only), extract
      if (isValidName(nextTok)) {
        addNames(readNameList(tokens, i + 1));
      }
      // else: intransitive "visited" — skip
      continue;
    }

    // "customer" followed by a name (not followed by "visited", "paid", etc.)
    if (tok === 'customer') {
      const nextRaw = i + 1 < tokens.length ? tokens[i + 1].replace(/[,.:;]+$/, '') : '';
      const nextTok = nextRaw.toLowerCase();
      if (isValidName(nextTok)) {
        addNames(readNameList(tokens, i + 1));
      }
      continue;
    }

    // Title words
    if (TITLE_WORDS.has(tok)) {
      // grab name after title
      if (i + 1 < tokens.length) {
        const nextRaw = tokens[i + 1].replace(/[,.:;]+$/, '');
        if (isValidName(nextRaw.toLowerCase())) {
          addNames([cap(nextRaw)]);
          // also continue reading for "and ..." following the name
          addNames(readNameList(tokens, i + 2));
        }
      }
      continue;
    }

    // Relation words: grab the name after the relation word
    if (RELATION_WORDS.has(tok)) {
      // possibly "wife said" → next is "said" (stop word) → no name
      if (i + 1 < tokens.length) {
        let j = i + 1;
        const nextRaw = tokens[j].replace(/[,.:;]+$/, '');
        const nextTok = nextRaw.toLowerCase();
        // skip pronouns
        if (nextTok === 'his' || nextTok === 'her' || nextTok === 'their') j++;
        if (j < tokens.length) {
          const nameRaw = tokens[j].replace(/[,.:;]+$/, '');
          if (isValidName(nameRaw.toLowerCase())) {
            addNames([cap(nameRaw)]);
          }
        }
      }
      continue;
    }
  }

  return names;
}

// ── Classification ────────────────────────────────────────────────────────────

const NEGATED_PAYMENT_PATTERNS = [
  /\bnot\s+paid\b/i,
  /\bdid\s+not\s+pay\b/i,
  /\bdidn'?t\s+pay\b/i,
  /\bnever\s+paid\b/i,
  /\bno\s+payment\b/i,
  /\bhas\s+not\s+given\b/i,
  /\bunable\s+to\s+pay\b/i,
  /\bhave\s+not\s+paid\b/i,
  /\bhas\s+not\s+paid\b/i,
];

const PAYMENT_VERBS = /\b(paid|gave|collected|received|deposited|cleared|settled)\b/gi;

function isNegatedVerb(text, matchIndex) {
  const before = text.slice(0, matchIndex);
  return /\b(not|no|never|did\s+not|does\s+not|has\s+not|have\s+not|hasn'?t|haven'?t|didn'?t|won'?t|can'?t|unable\s+to)\s*$/i.test(before);
}

function isPaid(cleanedText) {
  // Check explicit negated patterns first
  if (matchesAny(cleanedText, NEGATED_PAYMENT_PATTERNS)) return false;
  const re = new RegExp(PAYMENT_VERBS.source, 'gi');
  let m;
  while ((m = re.exec(cleanedText)) !== null) {
    if (!isNegatedVerb(cleanedText, m.index)) return true;
  }
  // "amount received", "payment received", "amount paid"
  const phrases = [/\bamount\s+received\b/i, /\bpayment\s+received\b/i, /\bamount\s+paid\b/i];
  for (const p of phrases) {
    const pm = p.exec(cleanedText);
    if (pm && !isNegatedVerb(cleanedText, pm.index)) return true;
  }
  return false;
}

// REFUSED
const INABILITY_PHRASES = [
  /\bdo\s+not\s+have\s+(any\s+)?money\b/i,
  /\bdoes\s+not\s+have\s+(any\s+)?money\b/i,
  /\bdo\s+not\s+have\s+(any\s+)?cash\b/i,
  /\bdoes\s+not\s+have\s+(any\s+)?cash\b/i,
  /\bno\s+money\b/i,
  /\bno\s+cash\b/i,
  /\bnot\s+have\s+(any\s+)?money\b/i,
  /\bnot\s+have\s+(any\s+)?cash\b/i,
  /\bcan\s+not\s+pay\b/i,
  /\bcannot\s+pay\b/i,
  /\brefuse[sd]?\b/i,
  /\bwill\s+not\s+pay\b/i,
  /\bnot\s+willing\b/i,
  /\bdenied\b/i,
];

const STRONG_PROMISE_PATTERNS = [
  /\bpromise[sd]?\b/i,
  /\bwill\s+pay\b/i,
  /\bwill\s+give(\s+money)?\b/i,
  /\bwill\s+arrange\b/i,
  /\bwill\s+bring\b/i,
  /\bwill\s+transfer\b/i,
  /\bpay\s+tomorrow\b/i,
  /\btomorrow\b/i,
  /\bnext\s+week\b/i,
  /\bnext\s+month\b/i,
  /\bin\s+\d+\s+days?\b/i,
  /\bafter\s+\d+\s+days?\b/i,
  /\bdeferred?\b/i,
  /\bmore\s+time\b/i,
  /\btold\s+(they|he|she)\s+will\s+give\b/i,
];

const WEAK_PROMISE_PATTERNS = [
  /\bsome\s+time\b/i,
  /\blater\b/i,
  /\bwait\b/i,
];

const UNAVAILABLE_PATTERNS = [
  /\bnot\s+at\s+home\b/i,
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
  /\bout\b/i,
];

function classify(cleanedText) {
  const hasNegatedPayment = matchesAny(cleanedText, NEGATED_PAYMENT_PATTERNS);

  if (!hasNegatedPayment && isPaid(cleanedText)) return 'PAID';

  const hasStrongPromise = matchesAny(cleanedText, STRONG_PROMISE_PATTERNS);
  const hasInability = matchesAny(cleanedText, INABILITY_PHRASES);
  const hasWeakPromise = matchesAny(cleanedText, WEAK_PROMISE_PATTERNS);
  const hasUnavailable = matchesAny(cleanedText, UNAVAILABLE_PATTERNS);

  // Promise beats inability
  if (hasStrongPromise) return 'PROMISED';
  if (hasInability) return 'REFUSED';
  if (hasWeakPromise) return 'PROMISED';
  if (hasUnavailable) return 'UNAVAILABLE';
  return 'GENERAL';
}

// ── Category Metadata ─────────────────────────────────────────────────────────

const CATEGORY_META = {
  PAID:        { summary: 'Payment Collected Successfully',          badge: 'Green' },
  PROMISED:    { summary: 'Payment Promised - Follow-up Required',   badge: 'Amber' },
  REFUSED:     { summary: 'Customer Refused - Escalation Required',  badge: 'Red'   },
  UNAVAILABLE: { summary: 'Customer Unavailable - Revisit Required', badge: 'Red'   },
  GENERAL:     { summary: 'Customer Contacted - General Follow-up',  badge: 'Gray'  },
};

export const BADGE_COLORS = {
  PAID:        { bg: '#DCFCE7', text: '#15803D', border: '#86EFAC' },
  PROMISED:    { bg: '#FEF9C3', text: '#A16207', border: '#FDE047' },
  REFUSED:     { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
  UNAVAILABLE: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
  GENERAL:     { bg: '#F1F5F9', text: '#475569', border: '#CBD5E1' },
};

// ── extractDetails ─────────────────────────────────────────────────────────────

/**
 * @param {string} text — raw (original) remark text
 * @returns {{ names, amounts, dates, phones, keyPoints }}
 */
export function extractDetails(text) {
  if (!text || typeof text !== 'string') {
    return { names: [], amounts: [], dates: [], phones: [], keyPoints: [] };
  }

  const cleaned = cleanText(text);

  const phones = extractPhones(text); // use original for phone (preserves hyphens/spaces)
  const amountObjs = extractAmounts(cleaned, phones);
  const amounts = amountObjs.map((a) => a.raw);
  const dates = extractDates(cleaned);
  const names = extractNames(cleaned);

  // Key points
  const keyPoints = [];
  if (isPaid(cleaned)) keyPoints.push('payment received');
  if (matchesAny(cleaned, STRONG_PROMISE_PATTERNS)) keyPoints.push('money promised');
  if (matchesAny(cleaned, INABILITY_PHRASES)) keyPoints.push('refused to pay');
  if (matchesAny(cleaned, UNAVAILABLE_PATTERNS)) keyPoints.push('not at home');
  if (/\bwaited\b/i.test(cleaned)) keyPoints.push('waited for customer');
  if (phones.length > 0) keyPoints.push('phone number noted');

  return { names, amounts, dates, phones, keyPoints };
}

// ── Build Summary ─────────────────────────────────────────────────────────────

/**
 * Determine WHO prefix from cleaned text + names.
 */
function getWho(cleanedText, names) {
  if (names.length === 0) return '';
  const tl = cleanedText.toLowerCase();
  if (/\bspoke\s+to\b/.test(tl) || /\btalked\s+to\b/.test(tl)) {
    return `Spoke to ${names.join(' and ')}`;
  }
  if (/\bmet\b|\bmeet\b/.test(tl)) {
    return `Met ${names.join(' and ')}`;
  }
  if (/\bcalled\b/.test(tl)) {
    return `Called ${names.join(' and ')}`;
  }
  // fallback: "Met"
  return `Met ${names.join(' and ')}`;
}

/**
 * Detect if text has a "balance" pattern: paid X... balance Y [when]
 * Returns { paidAmt, balanceAmt } or null.
 */
function detectPartialPayment(cleanedText, amountObjs, dates) {
  if (amountObjs.length < 2) return null;
  const tl = cleanedText.toLowerCase();

  // Pattern: "balance" keyword present
  if (/\bbalance\b/i.test(tl)) {
    // First amount = paid, last amount = balance
    const paid = amountObjs[0];
    const balance = amountObjs[amountObjs.length - 1];
    if (paid.value !== balance.value) {
      return { paidAmt: paid.raw, balanceAmt: balance.raw };
    }
  }

  // Pattern: paid X and promised Y
  if (/\bpromised?\b/i.test(tl) || /\bwill\s+pay\b/i.test(tl)) {
    // first amount = paid, second = promised
    return { paidAmt: amountObjs[0].raw, balanceAmt: amountObjs[1].raw };
  }

  return null;
}

function buildSummary(originalText, cleanedText, category, amountObjs, dates, names, phones) {
  const who = getWho(cleanedText, names);
  const tl = cleanedText.toLowerCase();
  const phone = phones.length > 0 ? phones[0] : '';

  function phoneStr() { return phone ? ` Phone: ${phone}.` : ''; }

  if (category === 'PAID') {
    const partial = detectPartialPayment(cleanedText, amountObjs, dates);
    if (partial) {
      const { paidAmt, balanceAmt } = partial;
      const when = dates.length > 0 ? ` ${dates[0]}` : '';
      const phonePart = phone ? ` Phone: ${phone}.` : '';
      if (who) {
        return truncate(`${who} - ${paidAmt} paid. Balance ${balanceAmt}${when}.${phonePart}`);
      } else {
        return truncate(`${paidAmt} paid. Balance ${balanceAmt}${when}.${phonePart}`);
      }
    }
    // Single amount paid
    const amt = amountObjs.length > 0 ? amountObjs[0].raw : '';
    const when = dates.length > 0 ? ` ${dates[0]}` : '';
    if (who) {
      return truncate(`${who} - ${amt ? amt + ' ' : ''}paid${when}.`);
    } else {
      if (amt) return truncate(`${amt} paid${when}.`);
      return truncate(`Payment received${when}.`);
    }
  }

  if (category === 'PROMISED') {
    const amt = amountObjs.length > 0 ? amountObjs[0].raw : '';
    const when = dates.length > 0 ? ` ${dates[0]}` : '';
    if (who) {
      if (amt) return truncate(`${who} - ${amt} promised${when}.${phoneStr()}`);
      return truncate(`${who} - money promised${when}.${phoneStr()}`);
    } else {
      if (amt) return truncate(`Payment promised ${amt}${when}.${phoneStr()}`);
      return truncate(`Payment promised${when}.${phoneStr()}`);
    }
  }

  if (category === 'REFUSED') {
    // Determine sub-reason
    const hasNoCash = /\bno\s+cash\b/i.test(tl) || /\bdoes\s+not\s+have\s+cash\b/i.test(tl) || /\bdo\s+not\s+have\s+cash\b/i.test(tl);
    const hasNoMoney = /\bno\s+money\b/i.test(tl) || /\bdo\s+not\s+have\s+(any\s+)?money\b/i.test(tl) || /\bdoes\s+not\s+have\s+(any\s+)?money\b/i.test(tl) || /\bnot\s+have\s+(any\s+)?money\b/i.test(tl) || /\bcan\s+not\s+pay\b/i.test(tl);
    const hasRefused = /\brefuse[sd]?\b/i.test(tl) || /\bwill\s+not\s+pay\b/i.test(tl) || /\bnot\s+willing\b/i.test(tl) || /\bdenied\b/i.test(tl) || /\bcan\s+not\s+pay\b/i.test(tl);

    let subReason = '';
    if (hasNoCash && !hasNoMoney) subReason = 'no cash';
    else if (hasNoMoney) subReason = 'no money';

    if (who) {
      if (subReason === 'no cash') return truncate(`${who} - says no cash.`);
      if (subReason === 'no money') return truncate(`${who} - says no money.`);
      return truncate(`${who} - refused to pay.`);
    } else {
      if (hasRefused && subReason === 'no money') return truncate('Customer refused to pay - says no money.');
      if (hasRefused && subReason === 'no cash') return truncate('Customer refused to pay - says no cash.');
      if (subReason === 'no cash') return truncate('Customer says no cash.');
      if (subReason === 'no money') return truncate('Customer says no money.');
      return truncate('Customer refused to pay.');
    }
  }

  if (category === 'UNAVAILABLE') {
    return 'Customer not at home.';
  }

  // GENERAL
  if (who) {
    if (phone) return truncate(`${who}.`);
    return truncate(`${who}.`);
  }
  if (phone) return `Customer Contacted - General Follow-up. Phone: ${phone}.`;
  return 'Customer Contacted - General Follow-up';
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * @param {string} remark
 * @returns {{ nlpSummary: string, nlpCategory: string, nlpDetails: object }}
 */
export function summarize(remark) {
  const fallback = {
    nlpSummary: CATEGORY_META['GENERAL'].summary,
    nlpCategory: 'GENERAL',
    nlpDetails: { names: [], amounts: [], dates: [], phones: [], keyPoints: [] },
  };

  if (!remark || typeof remark !== 'string') return fallback;
  const trimmed = remark.trim();
  if (!trimmed) return { ...fallback, nlpSummary: 'Customer Contacted - General Follow-up' };
  if (trimmed.length > 2000) return fallback;

  try {
    const cleaned = cleanText(trimmed);
    const category = classify(cleaned);

    const phones = extractPhones(trimmed);
    const amountObjs = extractAmounts(cleaned, phones);
    const amounts = amountObjs.map((a) => a.raw);
    const dates = extractDates(cleaned);
    const names = extractNames(cleaned);

    const keyPoints = [];
    if (isPaid(cleaned)) keyPoints.push('payment received');
    if (matchesAny(cleaned, STRONG_PROMISE_PATTERNS)) keyPoints.push('money promised');
    if (matchesAny(cleaned, INABILITY_PHRASES)) keyPoints.push('refused to pay');
    if (matchesAny(cleaned, UNAVAILABLE_PATTERNS)) keyPoints.push('not at home');
    if (/\bwaited\b/i.test(cleaned)) keyPoints.push('waited for customer');
    if (phones.length > 0) keyPoints.push('phone number noted');

    const nlpDetails = { names, amounts, dates, phones, keyPoints };
    const nlpSummary = buildSummary(trimmed, cleaned, category, amountObjs, dates, names, phones)
      || CATEGORY_META[category].summary;

    return { nlpSummary, nlpCategory: category, nlpDetails };
  } catch (err) {
    return fallback;
  }
}
