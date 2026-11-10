import type { AssetId, AssetRecord } from '@canvas/schema';

/**
 * Whether two lists hold the same assets in the same order.
 *
 * @param first - One list.
 * @param second - The other.
 * @returns True when they are equal.
 */
function isSameList(first: readonly AssetId[], second: readonly AssetId[]): boolean {
  return (
    first.length === second.length && first.every((assetId, index) => second[index] === assetId)
  );
}

/**
 * Which of a collaborator's images are still being processed (item 4, the design's
 * "Processing image…"): an asset is shown once the engine reported it on screen and still drawn
 * from its placeholder (`setVisibleAssets`) while the last record the board read says `uploading`
 * or `processing` (the board is linked, so the bytes verified; the pyramid is not made yet), and
 * stays shown until a record says otherwise: the engine may draw it from its original meanwhile,
 * which takes it out of the placeholders, and the spinner does not flicker off and on. The page's
 * own uploads are left out: they show their own state. It only listens: the follower's polls
 * ('s caps) bring the records, and nothing here asks for one. `onChange` is called with the
 * sorted assets only when they changed, so a board at rest reports nothing. On the thread the
 * engine renders on.
 */
export class ProcessingReport {
  private readonly processing = new Set<AssetId>();
  /** The processing assets the engine reported on screen since their record said so. */
  private readonly shown = new Set<AssetId>();
  /** The engine's last report of the placeholders on screen. */
  private visible: ReadonlySet<AssetId> = new Set();
  private reported: readonly AssetId[] = [];

  /**
   * Reports nothing yet.
   *
   * @param onChange - Receives the assets on screen still processing, when they change.
   * @param isOwn - Whether the page is uploading an asset itself (its own badge shows it).
   */
  constructor(
    private readonly onChange: ((assetIds: readonly AssetId[]) => void) | undefined,
    private readonly isOwn: (assetId: AssetId) => boolean,
  ) {}

  /**
   * Takes the engine's report of the assets on screen still drawn from their placeholder: the
   * processing ones among them are shown from now on.
   *
   * @param assetIds - The assets.
   */
  setVisible(assetIds: ReadonlySet<AssetId>): void {
    this.visible = assetIds;
    let isChanged = false;
    for (const assetId of assetIds) {
      if (!this.processing.has(assetId) || this.shown.has(assetId)) continue;
      this.shown.add(assetId);
      isChanged = true;
    }
    if (isChanged) this.update();
  }

  /**
   * Takes a record the board read.
   *
   * @param record - The record.
   */
  learn(record: AssetRecord): void {
    const isProcessing = record.status === 'uploading' || record.status === 'processing';
    const wasProcessing = this.processing.has(record.id);
    if (isProcessing === wasProcessing) return;
    if (isProcessing) {
      this.processing.add(record.id);
      if (!this.visible.has(record.id)) return;
      this.shown.add(record.id);
      this.update();
      return;
    }
    this.processing.delete(record.id);
    if (this.shown.delete(record.id)) this.update();
  }

  /** Forgets every record (the session ended, the source destroyed): nothing is processing. */
  clear(): void {
    this.processing.clear();
    this.shown.clear();
    this.visible = new Set();
    this.update();
  }

  /** Works out the assets to report, and reports them when they changed. */
  private update(): void {
    const now = [...this.shown].filter((assetId) => !this.isOwn(assetId)).sort();
    if (isSameList(now, this.reported)) return;
    this.reported = now;
    this.onChange?.(now);
  }
}
