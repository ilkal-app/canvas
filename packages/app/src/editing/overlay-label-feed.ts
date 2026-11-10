import type { OverlayLabel } from '@canvas/tools';

const NO_LABELS: readonly OverlayLabel[] = Object.freeze([]);

/**
 * Whether two labels say the same thing in the same place.
 *
 * @param first - A label.
 * @param second - Another.
 * @returns True when every field matches.
 */
function isSameLabel(first: OverlayLabel, second: OverlayLabel): boolean {
  return (
    first.kind === second.kind &&
    first.text === second.text &&
    first.at.x === second.at.x &&
    first.at.y === second.at.y &&
    first.axis === second.axis
  );
}

/**
 * The editing states' labels as the shell reads them: the tools publish the labels of
 * each overlay model they show (`SelectionOverlayModel.labels`: the size readout, gap lengths,
 * the locked notice), and the shell's label layer subscribes, so it renders again only when a
 * label changed, never per frame. Main thread.
 */
export class OverlayLabelFeed {
  private labels: readonly OverlayLabel[] = NO_LABELS;
  private readonly listeners = new Set<() => void>();

  /**
   * The labels now: the same array until they change, so it can be a `useSyncExternalStore`
   * snapshot.
   *
   * @returns The labels; empty for none.
   */
  snapshot(): readonly OverlayLabel[] {
    return this.labels;
  }

  /**
   * Publishes the labels of the overlay shown now; listeners hear of it only when they differ
   * from the last ones.
   *
   * @param labels - The labels; none if absent.
   */
  publish(labels: readonly OverlayLabel[] | undefined): void {
    const next = labels === undefined || labels.length === 0 ? NO_LABELS : labels;
    const previous = this.labels;
    if (
      next.length === previous.length &&
      next.every((label, index) => {
        const other = previous[index];
        return other !== undefined && isSameLabel(label, other);
      })
    )
      return;
    this.labels = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * Listens for changed labels.
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
