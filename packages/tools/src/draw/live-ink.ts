import type { FreehandObject } from '@canvas/schema';

/**
 * Where the draw tool shows a stroke under way when the page draws it itself: the app's
 * live ink overlay, which draws the stroke on the page's own animation frame, so the ink follows
 * the pen whatever the engine's frames do. The engine still meshes the stroke, invisibly, so at
 * the release the written stroke takes its preview's place with no rebuild. Main thread.
 */
export interface LiveInk {
  /**
   * Whether a page overlay is mounted to draw on; the draw tool reads it once at each press.
   *
   * @returns True to draw the stroke on the page.
   */
  isAttached(): boolean;
  /**
   * Shows the stroke so far: its pieces as the release will write them, in world units.
   *
   * @param pieces - The pieces, with their real opacity.
   * @param inputMs - When the newest input they take was made, ms on the events' `timeStamp`
   *   clock (`performance.now`'s), for the ink latency readout; absent when unknown.
   */
  show(pieces: readonly FreehandObject[], inputMs?: number): void;
  /** The stroke was written: keep showing it until the engine has drawn it. */
  release(): void;
  /** The stroke was dropped (Escape, the tool left, a refused command): clear at once. */
  clear(): void;
}
