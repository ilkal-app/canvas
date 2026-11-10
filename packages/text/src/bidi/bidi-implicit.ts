// The implicit part of the Unicode bidirectional algorithm (UAX #9, revision 51, Unicode 17.0.0;
//): within each isolating run sequence, weak types (W1–W7), paired brackets (N0),
// neutrals (N1, N2), then the implicit levels (I1, I2).

import { elementAt } from '../line-break/element-at.js';

import { pairedBracketOf } from './bidi-class.js';
import { isIsolateInitiator, K, type IsolatingRunSequence } from './bidi-explicit.js';

/**
 * Whether a class is a neutral or isolate formatting character for N1 and N2 (NI).
 *
 * @param type - A class index.
 * @returns Whether it is.
 */
function isNeutral(type: number): boolean {
  return (
    type === K.B ||
    type === K.S ||
    type === K.WS ||
    type === K.ON ||
    type === K.PDI ||
    isIsolateInitiator(type)
  );
}

/**
 * A class's strong direction for N0 and N1: EN and AN count as R.
 *
 * @param type - A class index.
 * @returns L, R, or -1 for a class with none.
 */
function strongOf(type: number): number {
  if (type === K.L) return K.L;
  if (type === K.R || type === K.AL || type === K.EN || type === K.AN) return K.R;
  return -1;
}

/**
 * A bracket's identity for pairing, with U+2329/U+232A matched to their canonical equivalents
 * U+3008/U+3009 (BD16).
 *
 * @param codepoint - The bracket.
 * @returns Its canonical codepoint.
 */
function canonicalBracket(codepoint: number): number {
  if (codepoint === 0x2329) return 0x3008;
  if (codepoint === 0x232a) return 0x3009;
  return codepoint;
}

/**
 * Rules W1–W7 on one sequence.
 *
 * @param sequence - The sequence.
 * @param types - The classes after X1–X8, updated in place.
 */
function resolveWeakTypes(sequence: IsolatingRunSequence, types: Uint8Array): void {
  const { indices, sos } = sequence;
  const at = (position: number): number => {
    const index = indices[position];
    return index === undefined ? -1 : elementAt(types, index);
  };
  const set = (position: number, type: number): void => {
    types[elementAt(indices, position)] = type;
  };
  let previous = sos;
  for (let position = 0; position < indices.length; position += 1) {
    // W1: a mark takes the type before it, ON after an isolate initiator or PDI.
    if (at(position) === K.NSM) {
      set(position, isIsolateInitiator(previous) || previous === K.PDI ? K.ON : previous);
    }
    previous = at(position);
  }
  let strong = sos;
  for (let position = 0; position < indices.length; position += 1) {
    const type = at(position);
    if (type === K.EN && strong === K.AL) set(position, K.AN); // W2
    if (type === K.L || type === K.R || type === K.AL) strong = type;
  }
  for (let position = 0; position < indices.length; position += 1) {
    if (at(position) === K.AL) set(position, K.R); // W3
  }
  for (let position = 1; position + 1 < indices.length; position += 1) {
    const type = at(position); // W4
    const before = at(position - 1);
    const after = at(position + 1);
    if (type === K.ES && before === K.EN && after === K.EN) set(position, K.EN);
    else if (type === K.CS && before === after && (before === K.EN || before === K.AN)) {
      set(position, before);
    }
  }
  for (let position = 0; position < indices.length; position += 1) {
    if (at(position) !== K.ET) continue; // W5: terminators next to a European number
    let end = position;
    while (end < indices.length && at(end) === K.ET) end += 1;
    const isTouchingNumber = (position > 0 && at(position - 1) === K.EN) || at(end) === K.EN;
    if (isTouchingNumber) for (let run = position; run < end; run += 1) set(run, K.EN);
    position = end - 1;
  }
  for (let position = 0; position < indices.length; position += 1) {
    const type = at(position); // W6
    if (type === K.ES || type === K.ET || type === K.CS) set(position, K.ON);
  }
  strong = sos;
  for (let position = 0; position < indices.length; position += 1) {
    const type = at(position); // W7
    if (type === K.EN && strong === K.L) set(position, K.L);
    if (type === K.L || type === K.R) strong = type;
  }
}

/**
 * Rule N0: paired brackets take the embedding direction, or the context's.
 *
 * @param sequence - The sequence.
 * @param types - The classes after W1–W7, updated in place.
 * @param codepoints - The paragraph's characters.
 * @param original - The paragraph's original classes.
 */
function resolveBrackets(
  sequence: IsolatingRunSequence,
  types: Uint8Array,
  codepoints: ArrayLike<number>,
  original: ArrayLike<number>,
): void {
  const { indices, level, sos } = sequence;
  const pairs: [open: number, close: number][] = [];
  const stack: { position: number; closer: number }[] = [];
  for (let position = 0; position < indices.length; position += 1) {
    const index = elementAt(indices, position);
    if (types[index] !== K.ON) continue;
    const bracket = pairedBracketOf(elementAt(codepoints, index));
    if (bracket === undefined) continue;
    if (bracket.type === 'o') {
      if (stack.length === 63) {
        pairs.length = 0; // BD16: the stack is full; the sequence has no bracket pairs.
        break;
      }
      stack.push({ position, closer: canonicalBracket(bracket.pair) });
      continue;
    }
    const closer = canonicalBracket(elementAt(codepoints, index));
    for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
      const opener = elementAt(stack, depth);
      if (opener.closer !== closer) continue;
      pairs.push([opener.position, position]);
      stack.length = depth;
      break;
    }
  }
  pairs.sort(([left], [right]) => left - right);
  const embedding = level % 2 === 1 ? K.R : K.L;
  const at = (position: number): number => {
    const index = indices[position];
    return index === undefined ? -1 : elementAt(types, index);
  };
  for (const [open, close] of pairs) {
    let isEmbeddingInside = false;
    let isOppositeInside = false;
    for (let position = open + 1; position < close; position += 1) {
      const strong = strongOf(at(position));
      if (strong === embedding) isEmbeddingInside = true;
      else if (strong >= 0) isOppositeInside = true;
    }
    let direction = -1;
    if (isEmbeddingInside) direction = embedding;
    else if (isOppositeInside) {
      let context = sos;
      for (let position = open - 1; position >= 0; position -= 1) {
        const strong = strongOf(at(position));
        if (strong >= 0) {
          context = strong;
          break;
        }
      }
      direction = context === embedding ? embedding : context;
    }
    if (direction < 0) continue;
    for (const bracket of [open, close]) {
      types[elementAt(indices, bracket)] = direction;
      // Marks that followed the bracket before W1 take its new type too.
      for (let position = bracket + 1; position < indices.length; position += 1) {
        const index = elementAt(indices, position);
        if (original[index] !== K.NSM) break;
        types[index] = direction;
      }
    }
  }
}

/**
 * Rules N1 and N2: neutrals take their neighbours' direction when both agree, else the
 * embedding direction.
 *
 * @param sequence - The sequence.
 * @param types - The classes after N0, updated in place.
 */
function resolveNeutrals(sequence: IsolatingRunSequence, types: Uint8Array): void {
  const { indices, level, sos, eos } = sequence;
  const embedding = level % 2 === 1 ? K.R : K.L;
  const at = (position: number): number => {
    const index = indices[position];
    return index === undefined ? -1 : elementAt(types, index);
  };
  for (let position = 0; position < indices.length; position += 1) {
    if (!isNeutral(at(position))) continue;
    let end = position;
    while (end < indices.length && isNeutral(at(end))) end += 1;
    const before = position === 0 ? sos : strongOf(at(position - 1));
    const after = end === indices.length ? eos : strongOf(at(end));
    const direction = before === after && before >= 0 ? before : embedding;
    for (let run = position; run < end; run += 1) types[elementAt(indices, run)] = direction;
    position = end - 1;
  }
}

/**
 * Resolves a sequence's weak types, brackets and neutrals, then its characters' levels (I1, I2).
 *
 * @param sequence - The sequence.
 * @param types - The classes after X1–X8, updated in place.
 * @param levels - The explicit levels, updated in place.
 * @param codepoints - The paragraph's characters.
 * @param original - The paragraph's original classes.
 */
export function resolveSequence(
  sequence: IsolatingRunSequence,
  types: Uint8Array,
  levels: Uint8Array,
  codepoints: ArrayLike<number>,
  original: ArrayLike<number>,
): void {
  resolveWeakTypes(sequence, types);
  resolveBrackets(sequence, types, codepoints, original);
  resolveNeutrals(sequence, types);
  for (const index of sequence.indices) {
    const type = elementAt(types, index);
    const level = elementAt(levels, index);
    if (level % 2 === 0) {
      if (type === K.R) levels[index] = level + 1;
      else if (type === K.AN || type === K.EN) levels[index] = level + 2;
    } else if (type === K.L || type === K.EN || type === K.AN) levels[index] = level + 1;
  }
}
