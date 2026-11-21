/**
 * On-device speedometer photo check.
 * Verifies that the captured photo contains at least one digit (0-9).
 * Runs 100% on-device with zero network calls.
 * If recognition throws, is unavailable, or times out (8s), it returns { ok: true, skipped: true }
 * so technical failures never block the recovery agent.
 */

let TextRecognitionModule = null;
try {
  const tr = require('@react-native-ml-kit/text-recognition');
  TextRecognitionModule = tr && tr.default ? tr.default : tr;
} catch (e) {
  TextRecognitionModule = null;
}

let isFirstCheck = true;

export function _resetFirstCheck() {
  isFirstCheck = true;
}

/**
 * Pure helper to test if a string contains any ASCII digit 0-9.
 * Lenient: does not require a minimum length or format.
 * Non-ASCII digits (such as Eastern Arabic numerals) return false.
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function containsDigit(text) {
  if (typeof text !== 'string') return false;
  return /[0-9]/.test(text);
}

/**
 * Checks whether an image contains numbers using on-device text recognition.
 *
 * @param {string} photoUri Local file URI of the captured photo
 * @param {object|function|null} [recognizerOverride] Optional recognizer for testing or custom runner
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: 'timeout'|'unavailable'|string }>}
 */
export async function checkHasNumbers(photoUri, recognizerOverride = null) {
  if (!photoUri) {
    return { ok: true, skipped: true, reason: 'unavailable' };
  }

  const recognizer = recognizerOverride || TextRecognitionModule;
  if (!recognizer) {
    return { ok: true, skipped: true, reason: 'unavailable' };
  }

  const timeoutMs = isFirstCheck ? 20000 : 8000;
  isFirstCheck = false;

  let timer = null;
  let didTimeout = false;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        didTimeout = true;
        const err = new Error('Speedometer check timed out');
        err.name = 'TimeoutError';
        reject(err);
      }, timeoutMs);
    });

    const callPromise = (async () => {
      if (typeof recognizer === 'function') {
        return await recognizer(photoUri);
      }
      if (recognizer && typeof recognizer.recognize === 'function') {
        return await recognizer.recognize(photoUri);
      }
      const err = new Error('Recognition tool unavailable');
      err.name = 'UnavailableError';
      throw err;
    })();

    const result = await Promise.race([callPromise, timeoutPromise]);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    let text = '';
    if (typeof result === 'string') {
      text = result;
    } else if (result && typeof result.text === 'string') {
      text = result.text;
    } else if (result && Array.isArray(result.blocks)) {
      text = result.blocks
        .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
        .join(' ');
    }

    if (containsDigit(text)) {
      return { ok: true };
    }

    return { ok: false };
  } catch (err) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // Technical failure must NEVER block the agent
    let reason = 'error';
    if (didTimeout || (err && err.name === 'TimeoutError') || (err && err.message && err.message.toLowerCase().includes('timeout'))) {
      reason = 'timeout';
    } else if ((err && err.name === 'UnavailableError') || (err && err.message && err.message.toLowerCase().includes('unavailable'))) {
      reason = 'unavailable';
    } else if (err && typeof err.name === 'string' && err.name && err.name !== 'Error' && /^[A-Za-z0-9_]+$/.test(err.name)) {
      reason = err.name;
    }
    return { ok: true, skipped: true, reason };
  }
}
