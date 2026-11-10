import type { AssetId } from '@canvas/schema';

import type { AssetSource } from './asset-source.js';

/**
 * Whether a set holds exactly the ids of another.
 *
 * @param first - One set.
 * @param second - The other.
 * @returns True when they hold the same ids.
 */
function isSameSet(first: ReadonlySet<AssetId>, second: ReadonlySet<AssetId>): boolean {
  if (first.size !== second.size) return false;
  for (const assetId of first) if (!second.has(assetId)) return false;
  return true;
}

/**
 * Reports to the source which assets the images on screen wait for, and those near the view or
 * ahead of the pan (`AssetSource.setVisibleAssets`): only when either set changed since
 * the last report, and allocating only then, so a frame that changes nothing costs one pass over
 * the few placeholders among the candidates. On the thread that renders.
 */
export class VisiblePendingReport {
  private reported: ReadonlySet<AssetId> = new Set();
  private reportedNear: ReadonlySet<AssetId> = new Set();

  /**
   * Reports the assets if they changed.
   *
   * @param source - The source; nothing when it takes no report.
   * @param pending - The assets of the visible images drawn from their placeholder this frame
   *   (the tally's set, reused frame to frame: copied when reported).
   * @param near - The assets of the near and prefetch images drawn from their placeholder (the
   *   tally's set, copied likewise).
   */
  report(source: AssetSource, pending: ReadonlySet<AssetId>, near: ReadonlySet<AssetId>): void {
    if (source.setVisibleAssets === undefined) return;
    if (isSameSet(pending, this.reported) && isSameSet(near, this.reportedNear)) return;
    this.reported = new Set(pending);
    this.reportedNear = new Set(near);
    source.setVisibleAssets(this.reported, this.reportedNear);
  }
}
