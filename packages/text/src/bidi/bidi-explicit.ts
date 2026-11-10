// The explicit part of the Unicode bidirectional algorithm (UAX #9, revision 51, Unicode 17.0.0;
//): embedding levels from the explicit formatting characters (X1–X8), the characters X9
// removes, and the isolating run sequences X10 forms. Works on Bidi_Class indices
// (`BIDI_CLASSES`), one per character of one paragraph.

import { elementAt } from '../line-break/element-at.js';

import { BIDI_CLASSES, type BidiClass } from './bidi-class.js';

/** Each class's index in `BIDI_CLASSES`, by name. */
export const K = Object.fromEntries(BIDI_CLASSES.map((name, index) => [name, index])) as Record<
  BidiClass,
  number
>;

/** The level a character removed by X9 reports. */
export const REMOVED = 255;

/** The deepest embedding level (BD2). */
const MAX_DEPTH = 125;

/**
 * Whether a class is an isolate initiator: LRI, RLI or FSI.
 *
 * @param type - A class index.
 * @returns Whether it is.
 */
export function isIsolateInitiator(type: number): boolean {
  return type === K.LRI || type === K.RLI || type === K.FSI;
}

/**
 * Whether X9 removes a character of a class: an embedding, override, PDF or BN.
 *
 * @param type - A class index.
 * @returns Whether it does.
 */
export function isRemovedByX9(type: number): boolean {
  return (
    type === K.RLE ||
    type === K.LRE ||
    type === K.RLO ||
    type === K.LRO ||
    type === K.PDF ||
    type === K.BN
  );
}

/**
 * Each isolate initiator's matching PDI (BD9), or -1; and each PDI's initiator, or -1.
 *
 * @param types - The paragraph's classes.
 * @returns Both, by character.
 */
export function matchIsolates(types: ArrayLike<number>): {
  pdiOf: Int32Array;
  initiatorOf: Int32Array;
} {
  const pdiOf = new Int32Array(types.length).fill(-1);
  const initiatorOf = new Int32Array(types.length).fill(-1);
  const open: number[] = [];
  for (let index = 0; index < types.length; index += 1) {
    const type = elementAt(types, index);
    if (isIsolateInitiator(type)) open.push(index);
    else if (type === K.PDI) {
      const initiator = open.pop();
      if (initiator !== undefined) {
        pdiOf[initiator] = index;
        initiatorOf[index] = initiator;
      }
    } else if (type === K.B) open.length = 0;
  }
  return { pdiOf, initiatorOf };
}

/**
 * The paragraph embedding level P2 and P3 find in a stretch: 1 when its first strong character
 * (skipping isolates) is R or AL, 0 when it is L, `undefined` when it has none.
 *
 * @param types - The classes.
 * @param start - The stretch's first character.
 * @param end - One past its last.
 * @param pdiOf - Each isolate initiator's matching PDI.
 * @returns The level, or `undefined`.
 */
export function firstStrongLevel(
  types: ArrayLike<number>,
  start: number,
  end: number,
  pdiOf: ArrayLike<number>,
): number | undefined {
  for (let index = start; index < end; index += 1) {
    const type = elementAt(types, index);
    if (type === K.L) return 0;
    if (type === K.R || type === K.AL) return 1;
    if (isIsolateInitiator(type)) {
      const pdi = elementAt(pdiOf, index);
      if (pdi < 0) return undefined;
      index = pdi;
    } else if (type === K.B) return undefined;
  }
  return undefined;
}

/** A directional status stack entry (X1). */
interface Status {
  readonly level: number;
  /** The override: -1 none, else the class index (L or R) it forces. */
  readonly override: number;
  readonly isIsolate: boolean;
}

/**
 * Rules X1–X8: each character's embedding level, and its class after any override.
 *
 * @param types - The paragraph's original classes.
 * @param paragraphLevel - Its embedding level, 0 or 1.
 * @param pdiOf - Each isolate initiator's matching PDI.
 * @returns The levels and the classes, by character.
 */
export function explicitLevels(
  types: ArrayLike<number>,
  paragraphLevel: number,
  pdiOf: ArrayLike<number>,
): { levels: Uint8Array; classes: Uint8Array } {
  const count = types.length;
  const levels = new Uint8Array(count);
  const classes = Uint8Array.from(types);
  const stack: Status[] = [{ level: paragraphLevel, override: -1, isIsolate: false }];
  let overflowIsolates = 0;
  let overflowEmbeddings = 0;
  let validIsolates = 0;
  // The paragraph's own entry is never popped.
  const top = (): Status => elementAt(stack, stack.length - 1);
  const next = (isRtl: boolean): number => {
    const level = top().level;
    return isRtl ? (level + 1) | 1 : (level + 2) & ~1;
  };
  for (let index = 0; index < count; index += 1) {
    const type = elementAt(types, index);
    if (type === K.RLE || type === K.LRE || type === K.RLO || type === K.LRO) {
      const level = next(type === K.RLE || type === K.RLO);
      levels[index] = top().level;
      if (level <= MAX_DEPTH && overflowIsolates === 0 && overflowEmbeddings === 0) {
        const override = type === K.RLO ? K.R : type === K.LRO ? K.L : -1;
        stack.push({ level, override, isIsolate: false });
      } else if (overflowIsolates === 0) overflowEmbeddings += 1;
    } else if (isIsolateInitiator(type)) {
      const status = top();
      levels[index] = status.level;
      if (status.override >= 0) classes[index] = status.override;
      let isRtl = type === K.RLI;
      if (type === K.FSI) {
        const pdi = elementAt(pdiOf, index);
        const end = pdi >= 0 ? pdi : count;
        isRtl = firstStrongLevel(types, index + 1, end, pdiOf) === 1;
      }
      const level = next(isRtl);
      if (level <= MAX_DEPTH && overflowIsolates === 0 && overflowEmbeddings === 0) {
        validIsolates += 1;
        stack.push({ level, override: -1, isIsolate: true });
      } else overflowIsolates += 1;
    } else if (type === K.PDI) {
      if (overflowIsolates > 0) overflowIsolates -= 1;
      else if (validIsolates > 0) {
        overflowEmbeddings = 0;
        while (!top().isIsolate) stack.pop();
        stack.pop();
        validIsolates -= 1;
      }
      const status = top();
      levels[index] = status.level;
      if (status.override >= 0) classes[index] = status.override;
    } else if (type === K.PDF) {
      if (overflowIsolates === 0) {
        if (overflowEmbeddings > 0) overflowEmbeddings -= 1;
        else if (!top().isIsolate && stack.length >= 2) stack.pop();
      }
      levels[index] = top().level;
    } else if (type === K.B) {
      levels[index] = paragraphLevel; // X8
    } else {
      const status = top();
      levels[index] = status.level;
      if (status.override >= 0 && type !== K.BN) classes[index] = status.override;
    }
  }
  return { levels, classes };
}

/** An isolating run sequence (BD13): its characters in order, and its sos and eos. */
export interface IsolatingRunSequence {
  readonly indices: number[];
  readonly level: number;
  /** The class before it: L or R. */
  readonly sos: number;
  /** The class after it: L or R. */
  readonly eos: number;
}

/**
 * Rule X10: the isolating run sequences of a paragraph, characters X9 removes left out.
 *
 * @param types - The original classes.
 * @param levels - The explicit levels.
 * @param paragraphLevel - The paragraph embedding level.
 * @param isolates - Matching isolates.
 * @param isolates.pdiOf - Each initiator's matching PDI.
 * @param isolates.initiatorOf - Each PDI's initiator.
 * @returns The sequences.
 */
export function isolatingRunSequences(
  types: ArrayLike<number>,
  levels: ArrayLike<number>,
  paragraphLevel: number,
  isolates: { readonly pdiOf: ArrayLike<number>; readonly initiatorOf: ArrayLike<number> },
): IsolatingRunSequence[] {
  const kept: number[] = [];
  for (let index = 0; index < types.length; index += 1) {
    if (!isRemovedByX9(elementAt(types, index))) kept.push(index);
  }
  // Level runs (BD7), over the characters kept.
  const runs: number[][] = [];
  for (const index of kept) {
    const run = runs.at(-1);
    const isSameLevel =
      run !== undefined && levels[elementAt(run, run.length - 1)] === levels[index];
    if (isSameLevel) run.push(index);
    else runs.push([index]);
  }
  // Every run holds at least one character.
  const runOfStart = new Map(runs.map((run) => [elementAt(run, 0), run]));
  const sequences: IsolatingRunSequence[] = [];
  const keptPosition = new Int32Array(types.length).fill(-1);
  for (const [position, index] of kept.entries()) keptPosition[index] = position;
  for (const run of runs) {
    const first = elementAt(run, 0);
    // A run starting with a PDI that matches an initiator continues that initiator's sequence.
    if (types[first] === K.PDI && elementAt(isolates.initiatorOf, first) >= 0) continue;
    const indices = [...run];
    for (;;) {
      const last = elementAt(indices, indices.length - 1);
      const pdi = isolatesPdi(types, last, isolates.pdiOf);
      const nextRun = pdi >= 0 ? runOfStart.get(pdi) : undefined;
      if (nextRun === undefined) break;
      indices.push(...nextRun);
    }
    const level = elementAt(levels, elementAt(indices, 0));
    const before = kept[elementAt(keptPosition, elementAt(indices, 0)) - 1];
    const levelBefore = before === undefined ? paragraphLevel : elementAt(levels, before);
    const last = elementAt(indices, indices.length - 1);
    const isOpenIsolate = isIsolateInitiator(elementAt(types, last));
    const after = kept[elementAt(keptPosition, last) + 1];
    const levelAfter =
      after === undefined || isOpenIsolate ? paragraphLevel : elementAt(levels, after);
    sequences.push({
      indices,
      level,
      sos: Math.max(level, levelBefore) % 2 === 1 ? K.R : K.L,
      eos: Math.max(level, levelAfter) % 2 === 1 ? K.R : K.L,
    });
  }
  return sequences;
}

/**
 * The matching PDI of a character that is an isolate initiator.
 *
 * @param types - The classes.
 * @param index - The character.
 * @param pdiOf - Each initiator's matching PDI.
 * @returns The PDI, or -1.
 */
function isolatesPdi(types: ArrayLike<number>, index: number, pdiOf: ArrayLike<number>): number {
  return isIsolateInitiator(elementAt(types, index)) ? elementAt(pdiOf, index) : -1;
}
