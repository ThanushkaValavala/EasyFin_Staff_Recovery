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
 * @returns {Promise<{ ok: boolean, skipped?: boolean }>}
 */
export async function checkHasNumbers(photoUri, recognizerOverride = null) {
  if (!photoUri) {
    return { ok: true, skipped: true };
  }

  const recognizer = recognizerOverride || TextRecognitionModule;
  if (!recognizer) {
    return { ok: true, skipped: true };
  }

  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Speedometer check timed out after 8 seconds'));
      }, 8000);
    });

    const callPromise = (async () => {
      if (typeof recognizer === 'function') {
        return await recognizer(photoUri);
      }
      if (recognizer && typeof recognizer.recognize === 'function') {
        return await recognizer.recognize(photoUri);
      }
      throw new Error('Recognition tool unavailable');
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
    return { ok: true, skipped: true };
  }
}
