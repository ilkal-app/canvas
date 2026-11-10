import type { AssetId } from '@canvas/schema';

/** No asset is processing: the snapshot at rest. */
const NONE: readonly AssetId[] = Object.freeze([]);

/**
 * The page's view of a collaborator's images on screen still processing (item 4): the
 * assets the engine's adapter last reported (`processing` on the app's link,
 * `ProcessingReport`), as a snapshot the shell's spinners render. It asks for nothing: the
 * adapter's follower polls within's caps. Page.
 */
export class ProcessingImages {
  private assets: readonly AssetId[] = NONE;
  private readonly listeners = new Set<() => void>();

  /**
   * The assets still processing, sorted; the same array until the next report.
   *
   * @returns The assets.
   */
  snapshot(): readonly AssetId[] {
    return this.assets;
  }

  /**
   * Calls `listener` after every change of {@link ProcessingImages.snapshot}.
   *
   * @param listener - Called with no arguments.
   * @returns Stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Takes the adapter's report.
   *
   * @param assetIds - The assets on screen still processing.
   */
  set(assetIds: readonly AssetId[]): void {
    this.assets = assetIds.length === 0 ? NONE : [...assetIds];
    for (const listener of this.listeners) listener();
  }
}
