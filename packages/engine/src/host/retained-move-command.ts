import type { BoardObject } from '@canvas/schema';

/** An ordered, transient root placement session (leaves, groups, non-clipping frames); never a document mutation. */
export type RetainedMoveCommand =
  | {
      /** Starts a session with its immutable base geometry. */
      readonly kind: 'begin';
      /** Positive session identity. */
      readonly session: number;
      /** Monotonically increasing command order within the session. */
      readonly sequence: number;
      /** Stable ordered base geometry, sent once rather than on each pointer update. */
      readonly objects: readonly BoardObject[];
      /** Absolute local x/y pairs, evaluated with the ordinary preview's double arithmetic. */
      readonly positions: Float64Array;
    }
  | {
      /** Replaces absolute placements within an existing session. */
      readonly kind: 'update';
      /** Positive session identity. */
      readonly session: number;
      /** Monotonically increasing command order within the session. */
      readonly sequence: number;
      /** Absolute local x/y pairs for the stable session membership. */
      readonly positions: Float64Array;
    }
  | {
      /**
       * Translates the whole membership: every root at its begin position plus the
       * delta, so a pure drag sends one pair rather than a pair per root.
       */
      readonly kind: 'update';
      /** Positive session identity. */
      readonly session: number;
      /** Monotonically increasing command order within the session. */
      readonly sequence: number;
      /** The translation from the begin positions, `[dx, dy]`. */
      readonly delta: readonly [number, number];
    }
  | {
      /** Restores ordinary document placement. */
      readonly kind: 'end';
      /** Positive session identity. */
      readonly session: number;
      /** Monotonically increasing command order within the session. */
      readonly sequence: number;
    };

/**
 * Checks the host boundary before any session state changes. Ordinary document validation
 * remains responsible for object fields; this checks the additional root-membership contract.
 *
 * @param value - The received command.
 * @returns Whether its positions, membership and ordering fields are structurally valid.
 */
export function isRetainedMoveCommand(value: unknown): value is RetainedMoveCommand {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, session, sequence, positions, objects, delta } = value as Record<string, unknown>;
  if (
    typeof session !== 'number' ||
    !Number.isSafeInteger(session) ||
    session <= 0 ||
    typeof sequence !== 'number' ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  )
    return false;
  if (kind === 'end') return true;
  if (kind !== 'begin' && kind !== 'update') return false;
  if (kind === 'update' && delta !== undefined) return positions === undefined && isDelta(delta);
  if (
    !(positions instanceof Float64Array) ||
    positions.length % 2 !== 0 ||
    !positions.every(Number.isFinite)
  )
    return false;
  if (kind === 'update') return true;
  if (!Array.isArray(objects) || objects.length === 0 || objects.length * 2 !== positions.length) {
    return false;
  }
  const ids = new Set<string>();
  for (const object of objects as unknown[]) {
    if (typeof object !== 'object' || object === null) return false;
    const { id, parentId, type, clip } = object as Record<string, unknown>;
    // Roots only: a root leaf, a group or a frame that does not clip, carrying its subtree.
    // Component mains and instances expand content and stay on change sets.
    if (
      typeof id !== 'string' ||
      parentId !== null ||
      (type === 'frame' && clip === true) ||
      type === 'component' ||
      type === 'instance' ||
      ids.has(id)
    )
      return false;
    ids.add(id);
  }
  return true;
}

/**
 * Whether a value is a finite translation, `[dx, dy]`.
 *
 * @param value - The value.
 * @returns True for exactly two finite numbers.
 */
function isDelta(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part))
  );
}
