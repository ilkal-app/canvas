import type * as Y from 'yjs';

import type { FieldProblem } from './decode-issue.js';
import { isSamePlainValue } from './plain-value.js';

// A two-member field kept as two own keys (fix round 1): a line's `points` is dragged one
// end at a time, often by two people at once, so each end is its own last-writer-wins key, as a
// connector's `from` and `to` are. Stored whole under one key, two people dragging different
// ends kept one person's pair, and undoing an end drag after a collaborator dragged the other
// end skipped the step (its one key was overwritten) and undid the step before it instead.
//
// Boards stored before the split (the earliest boards and fixtures) hold the whole pair under the
// field's own name. A member whose own key is absent is read from there, and a write sets only
// the members whose value changed, so the first end written on such a line gets its own key and
// the other end keeps being read from the old value until it is written in turn. The old key is
// never written or removed: removing it once both ends had their keys could empty an end, since
// undo may delete a key's first value (`history/field-guard.ts`), and then the old value is what
// the end reads again, which is the end as it was before that first write.

/** How a two-member field is stored: two own keys, and the key a whole pair was stored under. */
export interface PairCodec {
  /** The field's name, which is also the key of the whole pair on a board stored before the split. */
  readonly key: string;
  /** The key of each member, in order. */
  readonly parts: readonly [string, string];
}

/**
 * Reads one member of a pair as stored: its own key, else the matching member of a pair stored
 * whole under the field's name (a board stored before the split).
 *
 * @param map - The object's map.
 * @param codec - How the pair is stored.
 * @param index - Which member.
 * @returns The member's value, or `undefined` when neither key holds one.
 */
function storedMember(map: Y.Map<unknown>, codec: PairCodec, index: 0 | 1): unknown {
  const part = codec.parts[index];
  if (map.has(part)) return map.get(part);
  const whole = map.get(codec.key);
  return Array.isArray(whole) && whole.length === 2 ? (whole[index] as unknown) : undefined;
}

/**
 * Reads a pair into the object being built.
 *
 * @param map - The object's map.
 * @param codec - How the pair is stored.
 * @param target - The object being built; the pair is set under the field's name.
 * @returns `null` on success, else the member's key and why.
 */
export function readPair(
  map: Y.Map<unknown>,
  codec: PairCodec,
  target: Record<string, unknown>,
): FieldProblem | null {
  const members = [storedMember(map, codec, 0), storedMember(map, codec, 1)];
  const missing = members.findIndex((member) => member === undefined);
  if (missing !== -1) {
    return { field: codec.parts[missing === 0 ? 0 : 1], message: 'missing', isMissing: true };
  }
  target[codec.key] = members;
  return null;
}

/**
 * Writes the members of a pair whose stored value differs, each under its own key, so a write
 * that moves one end sets one key and leaves the other end to a concurrent writer.
 *
 * @param map - The object's map, integrated in a document.
 * @param codec - How the pair is stored.
 * @param value - The new pair.
 */
export function writePair(
  map: Y.Map<unknown>,
  codec: PairCodec,
  value: readonly [unknown, unknown],
): void {
  for (const index of [0, 1] as const) {
    if (!isSamePlainValue(storedMember(map, codec, index), value[index])) {
      map.set(codec.parts[index], value[index]);
    }
  }
}

/**
 * The entries of a pair in a new object's map: one per member.
 *
 * @param codec - How the pair is stored.
 * @param value - The pair.
 * @returns The two entries.
 */
export function pairEntries(
  codec: PairCodec,
  value: readonly [unknown, unknown],
): [string, unknown][] {
  return [
    [codec.parts[0], value[0]],
    [codec.parts[1], value[1]],
  ];
}
