import type { ObjectId } from '@canvas/schema';

/**
 * Where the person is editing text, as collaborators are shown it: the object and the
 * caret or selection, UTF-16 offsets into its text.
 */
export interface TextEditingSpot {
  /** The edited object. */
  readonly objectId: ObjectId;
  /** The selection's fixed end. */
  readonly anchor: number;
  /** The selection's moving end, where the caret is. */
  readonly focus: number;
}

/**
 * Whether two editing spots are the same object and offsets.
 *
 * @param first - A spot, or none.
 * @param second - Another.
 * @returns True when both are none, or every field matches.
 */
function isSameSpot(
  first: TextEditingSpot | undefined,
  second: TextEditingSpot | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return (
    first.objectId === second.objectId &&
    first.anchor === second.anchor &&
    first.focus === second.focus
  );
}

/**
 * Where the person is editing text, as the shell reads it for presence: the engine
 * publishes the spot after every change on screen (`MountText.changed`), and listeners hear of
 * it only when the object or an offset changed, so a frame of typing that moved nothing sends
 * nothing. Main thread.
 */
export class TextEditingFeed {
  private spot: TextEditingSpot | undefined;
  private readonly listeners = new Set<() => void>();

  /**
   * The spot now: the same object until it changes.
   *
   * @returns The spot, or `undefined` while nothing is edited.
   */
  snapshot(): TextEditingSpot | undefined {
    return this.spot;
  }

  /**
   * Publishes the spot now; listeners hear of it only when it differs from the last one.
   *
   * @param spot - The spot, or `undefined` when nothing is edited.
   */
  publish(spot: TextEditingSpot | undefined): void {
    if (isSameSpot(this.spot, spot)) return;
    this.spot = spot;
    for (const listener of this.listeners) listener();
  }

  /**
   * Listens for a changed spot.
   *
   * @param listener - Called after each change.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
