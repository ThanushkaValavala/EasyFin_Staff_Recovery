/**
 * Phone Number Normalization Utility
 * Standardizes mobile numbers to E.164 format (e.g. +919876543210).
 * Handles Indian numbers (10 digits default to +91).
 */

function normalizePhoneNumber(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return '';
  }

  const trimmed = rawPhone.trim();
  const hasLeadingPlus = trimmed.startsWith('+');
  let digitsOnly = trimmed.replace(/\D/g, '');

  if (!digitsOnly) {
    return '';
  }

  // If already had a plus
  if (hasLeadingPlus) {
    return `+${digitsOnly}`;
  }

  // If starts with 0 and has 11 digits (e.g. 09876543210)
  if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    digitsOnly = digitsOnly.slice(1);
  }

  // If 10 digits (Standard Indian mobile), prepend +91
  if (digitsOnly.length === 10) {
    return `+91${digitsOnly}`;
  }

  // If 12 digits starting with 91 (e.g. 919876543210)
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return `+${digitsOnly}`;
  }

  // Fallback: prepend + to the digits
  return `+${digitsOnly}`;
}

function isValidNormalizedPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

module.exports = {
  normalizePhoneNumber,
  isValidNormalizedPhone,
};
