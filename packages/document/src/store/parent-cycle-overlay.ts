import type { BoardObject, ObjectId } from '@canvas/schema';

import type { DecodeIssue } from '../codec/decode-issue.js';
import { findParentCycleBreaks, type StoredObjectLookup } from '../repair/parent-cycles.js';

/** One member the reader shows re-rooted, with the stored value it was computed from. */
interface OverlayEntry {
  /** The member as stored. */
  readonly stored: BoardObject;
  /** The member as shown: at the root, where the repair will write it. */
  readonly shown: BoardObject;
  /** The cycle's members, sorted. */
  readonly members: readonly ObjectId[];
}

/**
 * Whether two objects sit in the same place: same parent, position and rotation.
 *
 * @param first - One object.
 * @param second - The other.
 * @returns `true` when their placements are equal.
 */
export function isSamePlacement(first: BoardObject, second: BoardObject): boolean {
  return (
    first.parentId === second.parentId &&
    first.x === second.x &&
    first.y === second.y &&
    first.rotation === second.rotation
  );
}

/**
 * The reader's side of the parent-cycle break: the members a stored parent cycle has
 * the repair re-root, shown re-rooted without writing, so a snapshot never holds a parent cycle
 * (every object readable, every chain of ancestors ending at the root, every world placement
 * finite) before the repair has run or where it cannot write. The decision is the repair's own
 * (`findParentCycleBreaks`), so what a store shows is what the repair then writes. The cache
 * lays the shown values over the decoded ones; the overlay is empty on a board with no cycle.
 */
export class ParentCycleOverlay {
  #entries = new Map<ObjectId, OverlayEntry>();

  /**
   * The ids shown re-rooted now.
   *
   * @returns The ids.
   */
  ids(): IterableIterator<ObjectId> {
    return this.#entries.keys();
  }

  /**
   * Roots to materialize before a command changes another member's stored placement.
   *
   * @param changed - Members whose placement the command changes.
   * @returns Their cycle roots as currently shown, sorted by id.
   */
  repairsFor(changed: ReadonlySet<ObjectId>): BoardObject[] {
    return [...this.#entries.values()]
      .filter(({ members }) => members.some((id) => changed.has(id)))
      .map(({ shown }) => shown)
      .sort((first, second) => (first.id < second.id ? -1 : first.id > second.id ? 1 : 0));
  }

  /**
   * A member as stored, when the overlay shows it re-rooted.
   *
   * @param id - The object id.
   * @returns The stored value, or `undefined` when the overlay does not show the object.
   */
  storedOf(id: ObjectId): BoardObject | undefined {
    return this.#entries.get(id)?.stored;
  }

  /**
   * A member as shown, when the overlay shows it re-rooted.
   *
   * @param id - The object id.
   * @returns The shown value, or `undefined` when the overlay does not show the object.
   */
  shownOf(id: ObjectId): BoardObject | undefined {
    return this.#entries.get(id)?.shown;
  }

  /**
   * The object a patch of its placement starts from. A patch writes the whole placement group,
   * so a command moving a member the reader shows re-rooted (it computed the move in the frame
   * the member is shown in, the root) must write the shown parent with it, or the stored parent
   * would pair with a position in another frame. Stored values changed since the overlay was
   * computed (an earlier write in the same transaction) are patched as they are.
   *
   * @param current - The object as stored now.
   * @returns The object with its shown placement, or `current`.
   */
  placementBase(current: BoardObject): BoardObject {
    const entry = this.#entries.get(current.id);
    if (entry === undefined || !isSamePlacement(entry.stored, current)) return current;
    const { parentId, x, y, rotation } = entry.shown;
    return { ...current, parentId, x, y, rotation };
  }

  /**
   * Finds the cycles again after a change: those the changed objects' chains of ancestors run
   * into, and those shown so far (any change that breaks or reshapes one changed a member). A
   * member whose stored value and break did not change keeps its shown value, identical, so an
   * unchanged object stays the same value in the next snapshot.
   *
   * @param changed - The objects decoded again.
   * @param lookup - The objects as stored, the change included.
   */
  update(changed: Iterable<ObjectId>, lookup: StoredObjectLookup): void {
    const starts = new Set(changed);
    for (const { members } of this.#entries.values()) for (const id of members) starts.add(id);
    const next = new Map<ObjectId, OverlayEntry>();
    for (const { members, stored, rerooted } of findParentCycleBreaks(lookup, starts)) {
      const previous = this.#entries.get(rerooted.id);
      const isSame = previous?.stored === stored && isSamePlacement(previous.shown, rerooted);
      next.set(rerooted.id, { stored, shown: isSame ? previous.shown : rerooted, members });
    }
    this.#entries = next;
  }

  /**
   * The snapshot issues of the members shown re-rooted: one `parent-cycle` issue each, keyed by
   * the member's id.
   *
   * @returns The issues, by key.
   */
  issues(): [string, readonly DecodeIssue[]][] {
    return [...this.#entries].map(([id, { members }]) => [
      id,
      [
        Object.freeze({
          code: 'parent-cycle' as const,
          key: id,
          field: 'parentId',
          message: cycleMessage(members),
        }),
      ],
    ]);
  }
}

/**
 * Describes a cycle with a bounded member preview; the issue key retains the complete root id.
 *
 * @param members - Sorted member ids.
 * @returns A description shorter than 512 characters.
 */
function cycleMessage(members: readonly ObjectId[]): string {
  let preview = '';
  for (const id of members) {
    const next = `${preview.length === 0 ? '' : ', '}${id}`;
    const remaining = 320 - preview.length;
    if (next.length > remaining) {
      preview += `${next.slice(0, remaining)}…`;
      break;
    }
    preview += next;
  }
  return `a parent cycle of ${String(members.length)} members (${preview}); shown at the root until the repair writes it there`;
}
