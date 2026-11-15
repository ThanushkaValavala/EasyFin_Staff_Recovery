/**
 * NLP Summarizer — CommonJS port of the frontend deterministic mirror
 * Rules-based only, no network.
 * Priority: PAID > PROMISED > REFUSED > UNAVAILABLE > GENERAL
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

function truncate(s, max) {
  if (max === undefined) max = 200;
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function matchesAny(text, patterns) {
  return patterns.some(function(p) { return p.test(text); });
}

// ── Amount Parsing & Formatting ───────────────────────────────────────────────

/**
 * Parse a raw number string with optional suffix (k, thousand, lakh) to an integer.
 */
function parseAmountValue(numStr, suffix) {
  var n = parseFloat(numStr.replace(/,/g, ''));
  if (isNaN(n)) return null;
  var s = (suffix || '').toLowerCase().trim();
  if (s === 'lakh' || s === 'lakhs') return Math.round(n * 100000);
  if (s === 'k' || s === 'thousand') return Math.round(n * 1000);
  return Math.round(n);
}

function formatRs(value) {
  return 'Rs ' + Number(value).toLocaleString('en-IN');
}

// ── Phone Extraction ──────────────────────────────────────────────────────────

/**
 * Extract 10-digit phone numbers from ORIGINAL text (before cleaning removes hyphens/spaces).
 * A 10-digit number immediately followed by a currency marker is an amount, not a phone.
 */
function extractPhones(originalText) {
  var phones = [];
  var phoneSet = new Set();
  // Match solid 10-digit or 5+5 (space or hyphen separated)
  var re = /\b(\d{5})[\s-](\d{5})\b|\b(\d{10})\b/g;
  var m;
  while ((m = re.exec(originalText)) !== null) {
    var digits = m[1] ? (m[1] + m[2]) : m[3];
    if (digits.length !== 10) continue;
    // Check if immediately followed by a currency marker → it's an amount
    var afterIdx = m.index + m[0].length;
    var afterStr = originalText.slice(afterIdx).replace(/^\s*/, '');
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
  var phoneSet = new Set(phones);
  var amounts = [];
  var amountPositions = []; // track char positions to avoid double-counting

  function addAmount(value, start, end) {
    // Check overlap
    for (var i = 0; i < amountPositions.length; i++) {
      var s = amountPositions[i][0], e = amountPositions[i][1];
      if (start < e && end > s) return; // overlap
    }
    amountPositions.push([start, end]);
    amounts.push({ value: value, raw: formatRs(value) });
  }

  // 1. Currency prefix: Rs / ₹ / rupees followed by number with optional suffix
  var re1 = /(?:Rs\.?\s*|₹\s*|rupees?\s+)(\d[\d,]*)(?:\s*(lakh|lakhs|thousand|k))?\b/gi;
  var m;
  while ((m = re1.exec(cleanedText)) !== null) {
    var v = parseAmountValue(m[1], m[2]);
    if (v !== null && v > 0) addAmount(v, m.index, m.index + m[0].length);
  }

  // 2. Number with suffix: 2k, 1.5lakh (no space needed), 2 lakh
  var re2 = /\b(\d+(?:\.\d+)?)\s*(lakh|lakhs|thousand|k)\b/gi;
  while ((m = re2.exec(cleanedText)) !== null) {
    var v2 = parseAmountValue(m[1], m[2]);
    if (v2 !== null && v2 > 0) addAmount(v2, m.index, m.index + m[0].length);
  }

  // 3. Plain 3+ digit numbers not already captured
  var re3 = /\b(\d{3,})\b/g;
  while ((m = re3.exec(cleanedText)) !== null) {
    var digits = m[1];
    if (digits.length === 10 && phoneSet.has(digits)) continue;
    if (digits.length === 10) continue; // treat 10-digit as phone candidate
    // Skip if followed by time units (minutes, hours, seconds)
    var after = cleanedText.slice(m.index + digits.length).match(/^\s*(\w+)/);
    if (after && /^(minutes?|hours?|seconds?|mins?)$/i.test(after[1])) continue;
    // Skip if preceded by "in" or "after" (date context like "in 2 days") — but those are <3 digit usually
    var before = cleanedText.slice(0, m.index).match(/\b(\w+)\s*$/);
    if (before && /^(in|after)$/i.test(before[1])) continue;
    // Skip if followed by "days"
    if (after && /^days?$/i.test(after[1])) continue;
    var v3 = parseInt(digits, 10);
    if (v3 > 0) addAmount(v3, m.index, m.index + m[0].length);
  }

  return amounts;
}

// ── Date Extraction ───────────────────────────────────────────────────────────

function extractDates(cleanedText) {
  var dates = [];
  var dateSet = new Set();
  function add(d) { if (!dateSet.has(d)) { dateSet.add(d); dates.push(d); } }

  if (/\btoday\b/i.test(cleanedText)) add('today');
  if (/\btomorrow\b/i.test(cleanedText)) add('tomorrow');
  if (/\bnext\s+week\b/i.test(cleanedText)) add('next week');
  if (/\bnext\s+month\b/i.test(cleanedText)) add('next month');
  if (/\bend\s+of\s+month\b/i.test(cleanedText)) add('end of month');

  var inDays = cleanedText.match(/\bin\s+(\d+)\s+days?\b/i);
  if (inDays) add('in ' + inDays[1] + ' days');
  var afterDays = cleanedText.match(/\bafter\s+(\d+)\s+days?\b/i);
  if (afterDays) add('after ' + afterDays[1] + ' days');

  var weekday = cleanedText.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) add(cap(weekday[1]));

  var onDate = cleanedText.match(/\bon\s+(\d{1,2}(?:st|nd|rd|th)?)\b/i);
  if (onDate) add('on ' + onDate[1]);

  var ddmm = cleanedText.match(/\b(\d{1,2}\/\d{1,2})\b/);
  if (ddmm) add(ddmm[1]);

  return dates;
}

// ── Name Extraction ────────────────────────────────────────────────────────────

var NON_NAME_WORDS = new Set([
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
var STOP_WORDS_SET = new Set([
  'he', 'she', 'they', 'said', 'told', 'says', 'was', 'were', 'will', 'is',
  'paid', 'promised', 'not', 'came', 'but', 'then', 'asked', 'dont', 'cant', 'can',
  'do', 'does', 'did', 'has', 'have', 'had',
]);

var RELATION_WORDS = new Set(['wife', 'husband', 'son', 'daughter', 'brother', 'father', 'mother']);
var TITLE_WORDS = new Set(['mr', 'mrs', 'ms', 'shri', 'smt']);

/**
 * Check if a token is a valid name candidate.
 */
function isValidName(tok) {
  if (!tok) return false;
  var t = tok.toLowerCase();
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
  var names = [];
  var i = start;
  while (i < tokens.length) {
    var rawTok = tokens[i].replace(/[,.:;]+$/, '');
    var tok = rawTok.toLowerCase();

    if (STOP_WORDS_SET.has(tok)) break;
    if (tok === 'and' || tok === '&') { i++; continue; }
    if (tok === '' || tok === ',') { i++; continue; }

    // If it's a title word, skip it and grab the next token as name
    if (TITLE_WORDS.has(tok)) {
      i++;
      if (i < tokens.length) {
        var nextRaw = tokens[i].replace(/[,.:;]+$/, '');
        var nextTok = nextRaw.toLowerCase();
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
        var nextRaw2 = tokens[i].replace(/[,.:;]+$/, '');
        var nextTok2 = nextRaw2.toLowerCase();
        // Skip pronoun-like words before the relation trigger result
        if (nextTok2 === 'his' || nextTok2 === 'her' || nextTok2 === 'their') { i++; continue; }
        if (isValidName(nextTok2)) {
          names.push(cap(nextRaw2));
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
  var names = [];
  var nameSet = new Set();

  function addNames(arr) {
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      var key = n.toLowerCase();
      if (!nameSet.has(key)) {
        nameSet.add(key);
        names.push(n);
      }
    }
  }

  var tokens = cleanedText.split(/\s+/).filter(Boolean);
  var tl = cleanedText.toLowerCase();

  // Scan for multi-word triggers first (spoke to, talked to)
  var multiTriggers = [
    { phrase: 'spoke to' },
    { phrase: 'talked to' },
  ];

  for (var mi = 0; mi < multiTriggers.length; mi++) {
    var phrase = multiTriggers[mi].phrase;
    var idx = tl.indexOf(phrase);
    while (idx !== -1) {
      // Find position in token array after the trigger
      var afterText = cleanedText.slice(idx + phrase.length).trimStart();
      var afterTokens = afterText.split(/\s+/).filter(Boolean);
      addNames(readNameList(afterTokens, 0));
      idx = tl.indexOf(phrase, idx + 1);
    }
  }

  // Single-word triggers
  for (var i = 0; i < tokens.length; i++) {
    var rawTok = tokens[i].replace(/[,.:;]+$/, '');
    var tok = rawTok.toLowerCase();

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
      var nextRawV = i + 1 < tokens.length ? tokens[i + 1].replace(/[,.:;]+$/, '') : '';
      var nextTokV = nextRawV.toLowerCase();
      // If next token is a valid name (not "paid", not punctuation-only), extract
      if (isValidName(nextTokV)) {
        addNames(readNameList(tokens, i + 1));
      }
      // else: intransitive "visited" — skip
      continue;
    }

    // "customer" followed by a name (not followed by "visited", "paid", etc.)
    if (tok === 'customer') {
      var nextRawC = i + 1 < tokens.length ? tokens[i + 1].replace(/[,.:;]+$/, '') : '';
      var nextTokC = nextRawC.toLowerCase();
      if (isValidName(nextTokC)) {
        addNames(readNameList(tokens, i + 1));
      }
      continue;
    }

    // Title words
    if (TITLE_WORDS.has(tok)) {
      // grab name after title
      if (i + 1 < tokens.length) {
        var nextRawT = tokens[i + 1].replace(/[,.:;]+$/, '');
        if (isValidName(nextRawT.toLowerCase())) {
          addNames([cap(nextRawT)]);
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
        var j = i + 1;
        var nextRawR = tokens[j].replace(/[,.:;]+$/, '');
        var nextTokR = nextRawR.toLowerCase();
        // skip pronouns
        if (nextTokR === 'his' || nextTokR === 'her' || nextTokR === 'their') j++;
        if (j < tokens.length) {
          var nameRaw = tokens[j].replace(/[,.:;]+$/, '');
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

var NEGATED_PAYMENT_PATTERNS = [
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

var PAYMENT_VERBS = /\b(paid|gave|collected|received|deposited|cleared|settled)\b/gi;

function isNegatedVerb(text, matchIndex) {
  var before = text.slice(0, matchIndex);
  return /\b(not|no|never|did\s+not|does\s+not|has\s+not|have\s+not|hasn'?t|haven'?t|didn'?t|won'?t|can'?t|unable\s+to)\s*$/i.test(before);
}

function isPaid(cleanedText) {
  // Check explicit negated patterns first
  if (matchesAny(cleanedText, NEGATED_PAYMENT_PATTERNS)) return false;
  var re = new RegExp(PAYMENT_VERBS.source, 'gi');
  var m;
  while ((m = re.exec(cleanedText)) !== null) {
    if (!isNegatedVerb(cleanedText, m.index)) return true;
  }
  // "amount received", "payment received", "amount paid"
  var phrases = [/\bamount\s+received\b/i, /\bpayment\s+received\b/i, /\bamount\s+paid\b/i];
  for (var i = 0; i < phrases.length; i++) {
    var pm = phrases[i].exec(cleanedText);
    if (pm && !isNegatedVerb(cleanedText, pm.index)) return true;
  }
  return false;
}

// REFUSED
var INABILITY_PHRASES = [
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

var STRONG_PROMISE_PATTERNS = [
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

var WEAK_PROMISE_PATTERNS = [
  /\bsome\s+time\b/i,
  /\blater\b/i,
  /\bwait\b/i,
];

var UNAVAILABLE_PATTERNS = [
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
  var hasNegatedPayment = matchesAny(cleanedText, NEGATED_PAYMENT_PATTERNS);

  if (!hasNegatedPayment && isPaid(cleanedText)) return 'PAID';

  var hasStrongPromise = matchesAny(cleanedText, STRONG_PROMISE_PATTERNS);
  var hasInability = matchesAny(cleanedText, INABILITY_PHRASES);
  var hasWeakPromise = matchesAny(cleanedText, WEAK_PROMISE_PATTERNS);
  var hasUnavailable = matchesAny(cleanedText, UNAVAILABLE_PATTERNS);

  // Promise beats inability
  if (hasStrongPromise) return 'PROMISED';
  if (hasInability) return 'REFUSED';
  if (hasWeakPromise) return 'PROMISED';
  if (hasUnavailable) return 'UNAVAILABLE';
  return 'GENERAL';
}

// ── Category Metadata ─────────────────────────────────────────────────────────

var CATEGORY_META = {
  PAID:        { summary: 'Payment Collected Successfully',          badge: 'Green' },
  PROMISED:    { summary: 'Payment Promised - Follow-up Required',   badge: 'Amber' },
  REFUSED:     { summary: 'Customer Refused - Escalation Required',  badge: 'Red'   },
  UNAVAILABLE: { summary: 'Customer Unavailable - Revisit Required', badge: 'Red'   },
  GENERAL:     { summary: 'Customer Contacted - General Follow-up',  badge: 'Gray'  },
};

// ── extractDetails ─────────────────────────────────────────────────────────────

/**
 * @param {string} text — raw (original) remark text
 * @returns {{ names, amounts, dates, phones, keyPoints }}
 */
function extractDetails(text) {
  if (!text || typeof text !== 'string') {
    return { names: [], amounts: [], dates: [], phones: [], keyPoints: [] };
  }

  var cleaned = cleanText(text);

  var phones = extractPhones(text); // use original for phone (preserves hyphens/spaces)
  var amountObjs = extractAmounts(cleaned, phones);
  var amounts = amountObjs.map(function(a) { return a.raw; });
  var dates = extractDates(cleaned);
  var names = extractNames(cleaned);

  // Key points
  var keyPoints = [];
  if (isPaid(cleaned)) keyPoints.push('payment received');
  if (matchesAny(cleaned, STRONG_PROMISE_PATTERNS)) keyPoints.push('money promised');
  if (matchesAny(cleaned, INABILITY_PHRASES)) keyPoints.push('refused to pay');
  if (matchesAny(cleaned, UNAVAILABLE_PATTERNS)) keyPoints.push('not at home');
  if (/\bwaited\b/i.test(cleaned)) keyPoints.push('waited for customer');
  if (phones.length > 0) keyPoints.push('phone number noted');

  return { names: names, amounts: amounts, dates: dates, phones: phones, keyPoints: keyPoints };
}

// ── Build Summary ─────────────────────────────────────────────────────────────

/**
 * Determine WHO prefix from cleaned text + names.
 */
function getWho(cleanedText, names) {
  if (names.length === 0) return '';
  var tl = cleanedText.toLowerCase();
  if (/\bspoke\s+to\b/.test(tl) || /\btalked\s+to\b/.test(tl)) {
    return 'Spoke to ' + names.join(' and ');
  }
  if (/\bmet\b|\bmeet\b/.test(tl)) {
    return 'Met ' + names.join(' and ');
  }
  if (/\bcalled\b/.test(tl)) {
    return 'Called ' + names.join(' and ');
  }
  // fallback: "Met"
  return 'Met ' + names.join(' and ');
}

/**
 * Detect if text has a "balance" pattern: paid X... balance Y [when]
 * Returns { paidAmt, balanceAmt } or null.
 */
function detectPartialPayment(cleanedText, amountObjs, dates) {
  if (amountObjs.length < 2) return null;
  var tl = cleanedText.toLowerCase();

  // Pattern: "balance" keyword present
  if (/\bbalance\b/i.test(tl)) {
    // First amount = paid, last amount = balance
    var paid = amountObjs[0];
    var balance = amountObjs[amountObjs.length - 1];
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
  var who = getWho(cleanedText, names);
  var tl = cleanedText.toLowerCase();
  var phone = phones.length > 0 ? phones[0] : '';

  function phoneStr() { return phone ? ' Phone: ' + phone + '.' : ''; }

  if (category === 'PAID') {
    var partial = detectPartialPayment(cleanedText, amountObjs, dates);
    if (partial) {
      var paidAmt = partial.paidAmt;
      var balanceAmt = partial.balanceAmt;
      var when = dates.length > 0 ? ' ' + dates[0] : '';
      var phonePart = phone ? ' Phone: ' + phone + '.' : '';
      if (who) {
        return truncate(who + ' - ' + paidAmt + ' paid. Balance ' + balanceAmt + when + '.' + phonePart);
      } else {
        return truncate(paidAmt + ' paid. Balance ' + balanceAmt + when + '.' + phonePart);
      }
    }
    // Single amount paid
    var amt = amountObjs.length > 0 ? amountObjs[0].raw : '';
    var when2 = dates.length > 0 ? ' ' + dates[0] : '';
    if (who) {
      return truncate(who + ' - ' + (amt ? amt + ' ' : '') + 'paid' + when2 + '.');
    } else {
      if (amt) return truncate(amt + ' paid' + when2 + '.');
      return truncate('Payment received' + when2 + '.');
    }
  }

  if (category === 'PROMISED') {
    var amtP = amountObjs.length > 0 ? amountObjs[0].raw : '';
    var whenP = dates.length > 0 ? ' ' + dates[0] : '';
    if (who) {
      if (amtP) return truncate(who + ' - ' + amtP + ' promised' + whenP + '.' + phoneStr());
      return truncate(who + ' - money promised' + whenP + '.' + phoneStr());
    } else {
      if (amtP) return truncate('Payment promised ' + amtP + whenP + '.' + phoneStr());
      return truncate('Payment promised' + whenP + '.' + phoneStr());
    }
  }

  if (category === 'REFUSED') {
    // Determine sub-reason
    var hasNoCash = /\bno\s+cash\b/i.test(tl) || /\bdoes\s+not\s+have\s+cash\b/i.test(tl) || /\bdo\s+not\s+have\s+cash\b/i.test(tl);
    var hasNoMoney = /\bno\s+money\b/i.test(tl) || /\bdo\s+not\s+have\s+(any\s+)?money\b/i.test(tl) || /\bdoes\s+not\s+have\s+(any\s+)?money\b/i.test(tl) || /\bnot\s+have\s+(any\s+)?money\b/i.test(tl) || /\bcan\s+not\s+pay\b/i.test(tl);
    var hasRefused = /\brefuse[sd]?\b/i.test(tl) || /\bwill\s+not\s+pay\b/i.test(tl) || /\bnot\s+willing\b/i.test(tl) || /\bdenied\b/i.test(tl) || /\bcan\s+not\s+pay\b/i.test(tl);

    var subReason = '';
    if (hasNoCash && !hasNoMoney) subReason = 'no cash';
    else if (hasNoMoney) subReason = 'no money';

    if (who) {
      if (subReason === 'no cash') return truncate(who + ' - says no cash.');
      if (subReason === 'no money') return truncate(who + ' - says no money.');
      return truncate(who + ' - refused to pay.');
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
    if (phone) return truncate(who + '.');
    return truncate(who + '.');
  }
  if (phone) return 'Customer Contacted - General Follow-up. Phone: ' + phone + '.';
  return 'Customer Contacted - General Follow-up';
}

// ── RULES (kept for backward compatibility export) ────────────────────────────

var RULES = [
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
    patterns: STRONG_PROMISE_PATTERNS,
  },
  {
    category: 'REFUSED',
    summary: CATEGORY_META.REFUSED.summary,
    badge: CATEGORY_META.REFUSED.badge,
    patterns: INABILITY_PHRASES,
  },
  {
    category: 'UNAVAILABLE',
    summary: CATEGORY_META.UNAVAILABLE.summary,
    badge: CATEGORY_META.UNAVAILABLE.badge,
    patterns: UNAVAILABLE_PATTERNS,
  },
];

var DEFAULT_RESULT = {
  category: 'GENERAL',
  summary: CATEGORY_META.GENERAL.summary,
  badge: CATEGORY_META.GENERAL.badge,
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Summarize customer visit remarks according to strict priority order.
 *
 * @param {string} remark
 * @returns {{ nlpSummary: string, nlpCategory: string, nlpDetails: object }}
 */
function summarize(remark) {
  var fallback = {
    nlpSummary: CATEGORY_META['GENERAL'].summary,
    nlpCategory: 'GENERAL',
    nlpDetails: { names: [], amounts: [], dates: [], phones: [], keyPoints: [] },
  };

  if (!remark || typeof remark !== 'string') return fallback;
  var trimmed = remark.trim();
  if (!trimmed) return Object.assign({}, fallback, { nlpSummary: 'Customer Contacted - General Follow-up' });
  if (trimmed.length > 2000) return fallback;

  try {
    var cleaned = cleanText(trimmed);
    var category = classify(cleaned);

    var phones = extractPhones(trimmed);
    var amountObjs = extractAmounts(cleaned, phones);
    var amounts = amountObjs.map(function(a) { return a.raw; });
    var dates = extractDates(cleaned);
    var names = extractNames(cleaned);

    var keyPoints = [];
    if (isPaid(cleaned)) keyPoints.push('payment received');
    if (matchesAny(cleaned, STRONG_PROMISE_PATTERNS)) keyPoints.push('money promised');
    if (matchesAny(cleaned, INABILITY_PHRASES)) keyPoints.push('refused to pay');
    if (matchesAny(cleaned, UNAVAILABLE_PATTERNS)) keyPoints.push('not at home');
    if (/\bwaited\b/i.test(cleaned)) keyPoints.push('waited for customer');
    if (phones.length > 0) keyPoints.push('phone number noted');

    var nlpDetails = { names: names, amounts: amounts, dates: dates, phones: phones, keyPoints: keyPoints };
    var nlpSummary = buildSummary(trimmed, cleaned, category, amountObjs, dates, names, phones)
      || CATEGORY_META[category].summary;

    return { nlpSummary: nlpSummary, nlpCategory: category, nlpDetails: nlpDetails };
  } catch (err) {
    return fallback;
  }
}

module.exports = {
  summarize: summarize,
  extractDetails: extractDetails,
  RULES: RULES,
  DEFAULT_RESULT: DEFAULT_RESULT,
};
