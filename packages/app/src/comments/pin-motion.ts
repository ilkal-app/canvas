/**
 * How long a pin stays hidden after its object last moved, ms (the approved motion
 * spec: pins come back 120 ms after the drop).
 */
export const PIN_SETTLE_MS = 120;

/** A pin's place last seen, and when it last changed. */
interface Seen {
  readonly place: string;
  readonly changedAt: number;
}

/**
 * Which comment pins hide because their object is moving: while the person's own
 * gesture moves, resizes or rotates it (or a group or frame holding it), and while its place in
 * the document keeps changing (a collaborator's move, resize or rotation, or the drop of one's
 * own), until {@link PIN_SETTLE_MS} after the last change. A place is the caller's key of the pin's
 * board point and its object's and ancestors' places, so the camera never counts as a move. Pure
 * apart from what it remembers; the caller gives the clock.
 */
export class PinMotion {
  private readonly seen = new Map<string, Seen>();

  /**
   * Notes a pin's place now and says whether it is hidden.
   *
   * @param id - The pin's thread.
   * @param place - A key of its place as the document has it now: its board point and the places
   *   of its object and the groups or frames holding it.
   * @param now - The time, ms.
   * @param isGestureMoving - Whether the person's gesture moves its object now.
   * @returns True while it should be hidden.
   */
  isHidden(id: string, place: string, now: number, isGestureMoving: boolean): boolean {
    const previous = this.seen.get(id);
    const hasMoved = previous !== undefined && previous.place !== place;
    const changedAt = hasMoved ? now : (previous?.changedAt ?? Number.NEGATIVE_INFINITY);
    this.seen.set(id, { place, changedAt });
    return isGestureMoving || now - changedAt < PIN_SETTLE_MS;
  }

  /**
   * Forgets the pins not among these, so a pin seen again starts afresh.
   *
   * @param ids - The pins still shown.
   */
  keepOnly(ids: ReadonlySet<string>): void {
    for (const id of this.seen.keys()) if (!ids.has(id)) this.seen.delete(id);
  }
}
