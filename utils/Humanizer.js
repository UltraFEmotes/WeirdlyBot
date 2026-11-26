/**
 * HUMANIZER
 *
 * Makes bot replies feel like a real person typed them:
 * - random small typos (swapped / dropped / doubled letters) that get
 *   corrected with a message edit a few seconds later
 * - randomised reply + edit delays
 * - occasionally splitting a longer reply into two messages
 */

/**
 * Random integer between min and max (inclusive).
 */
export function rand(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * True with the given probability (0-1).
 */
export function chance(probability) {
  return Math.random() < probability;
}

// ─── Typo mutations ──────────────────────────────────────────────────────────

function swapAdjacent(word) {
  if (word.length < 4) return null;
  const pos = rand(0, word.length - 2);
  return word.slice(0, pos) + word[pos + 1] + word[pos] + word.slice(pos + 2);
}

function dropLetter(word) {
  if (word.length < 4) return null;
  const pos = rand(1, word.length - 1);
  return word.slice(0, pos) + word.slice(pos + 1);
}

function doubleLetter(word) {
  if (word.length < 4) return null;
  const pos = rand(1, word.length - 1);
  return word.slice(0, pos + 1) + word[pos] + word.slice(pos + 1);
}

const MUTATIONS = [swapAdjacent, dropLetter, doubleLetter];

/**
 * With `typoChance` probability, mangle one word in the text.
 * Never touches code blocks or words with digits/punctuation (links etc).
 *
 * @param {string} text - the correct reply text
 * @param {number} typoChance - probability (0-1) of introducing a typo
 * @returns {{ text: string, corrected: string, hasTypo: boolean }}
 *          text = what to send (possibly with a typo),
 *          corrected = the original text to edit to later
 */
export function introduceTypo(text, typoChance = 0.2) {
  if (!text || !chance(typoChance)) {
    return { text, corrected: text, hasTypo: false };
  }
  // never typo code blocks — that would break them
  if (text.includes("```")) {
    return { text, corrected: text, hasTypo: false };
  }

  const tokens = text.split(/(\s+)/);
  const candidates = [];
  for (let i = 0; i < tokens.length; i += 2) {
    // even indexes are words, odd indexes are the whitespace between them
    if (tokens[i] && /^[a-zA-Z]{4,}$/.test(tokens[i])) candidates.push(i);
  }
  if (candidates.length === 0) {
    return { text, corrected: text, hasTypo: false };
  }

  const index = candidates[rand(0, candidates.length - 1)];
  const word = tokens[index];

  const mutate = MUTATIONS[rand(0, MUTATIONS.length - 1)];
  const mutated = mutate(word);
  if (!mutated || mutated === word) {
    return { text, corrected: text, hasTypo: false };
  }

  const withTypo = [...tokens];
  withTypo[index] = mutated;
  return { text: withTypo.join(""), corrected: text, hasTypo: true };
}

// ─── Message splitting ───────────────────────────────────────────────────────

/**
 * Whether the text is a candidate for being split into two messages.
 */
export function shouldSplit(text) {
  if (!text || text.length <= 140) return false;
  const sentences = text.match(/[^.!?…]+[.!?…]*/g) || [];
  return sentences.length >= 2;
}

/**
 * Split text into two messages at a sentence boundary near the middle.
 */
export function splitMessage(text) {
  const sentences = text.match(/[^.!?…]+[.!?…]*/g) || [text];
  if (sentences.length < 2) return [text];

  const splitAt = Math.max(1, Math.floor(sentences.length / 2));
  const first = sentences.slice(0, splitAt).join("").trim();
  const second = sentences.slice(splitAt).join("").trim();

  if (!first || !second) return [text];
  return [first, second];
}
