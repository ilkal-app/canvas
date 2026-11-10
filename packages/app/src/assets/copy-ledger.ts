import type { AssetId } from '@canvas/schema';

import type { CopiedAssets } from './copied-assets.js';

/**
 * How many (asset, board) pairs a tab keeps in memory: the most recent copies, each whole. A
 * board holds at most 5,000 objects, so this is several full copies, and a pair costs about a
 * hundred bytes, so it is a couple of megabytes at most.
 */
export const MAX_TAB_COPIED_ASSETS = 20_000;

/**
 * The sentence when a paste onto another board holds more images than the record of copies takes
 * (`MAX_ASSETS_PER_COPY`) and this tab did not make the copy (after a reload, or in another tab).
 * Names no board, id or URL.
 */
export const CROSS_BOARD_TOO_MANY_MESSAGE =
  'The images could not be pasted: at most 2,000 images can be pasted onto another board at once.';

/** One copy this tab made: the board it was made on and its distinct images. */
interface TabCopy {
  /** The board. */
  readonly boardId: string;
  /** The copy's distinct assets. */
  readonly assetIds: ReadonlySet<AssetId>;
}

/**
 * What this browser copied images from, as a page asks it: the stored record
 * (`CopiedAssets`, shared by the app's tabs, bounded and expiring) and, beside it, the pairs
 * this tab copied or cut itself, in the page's memory. A clipboard, a remote update or a URL
 * cannot write page memory, so trusting it is as safe as trusting the stored record; it lives as
 * long as the tab, with no age limit, and holds each copy whole up to `MAX_TAB_COPIED_ASSETS`
 * pairs (the oldest copy goes first beyond that; a copy of more is not held). So a cut and paste
 * on one board keeps working when the storage is blocked, after a day, and above the stored
 * record's bound, and a paste of more than that onto another board works in the tab that copied
 * it, but not after a reload or in another tab. A pair is trusted if either holds it. Main
 * thread.
 */
export class CopyLedger {
  private readonly stored: CopiedAssets;
  private readonly copies: TabCopy[] = [];
  private held = 0;

  /**
   * Makes a ledger beside a stored record.
   *
   * @param stored - The stored record, which every copy is written to as well.
   */
  constructor(stored: CopiedAssets) {
    this.stored = stored;
  }

  /**
   * Remembers that images were copied (or cut) from a board, in the stored record and in this
   * tab's memory.
   *
   * @param assetIds - The copied images' assets.
   * @param boardId - The board they were copied from.
   */
  record(assetIds: readonly AssetId[], boardId: string): void {
    this.stored.record(assetIds, boardId);
    const distinct = new Set(assetIds);
    if (distinct.size === 0 || distinct.size > MAX_TAB_COPIED_ASSETS) return;
    this.copies.push({ boardId, assetIds: distinct });
    this.held += distinct.size;
    while (this.held > MAX_TAB_COPIED_ASSETS) {
      const oldest = this.copies.shift();
      this.held -= oldest?.assetIds.size ?? this.held;
    }
  }

  /**
   * Tells whether this browser copied every one of the images from the board: each pair is in
   * this tab's memory or in the stored record (read once, for those the memory lacks).
   *
   * @param assetIds - The images' assets.
   * @param boardId - The board a paste's clipboard names as their source.
   * @returns Whether every (asset, board) pair is held.
   */
  wasCopiedFrom(assetIds: readonly AssetId[], boardId: string): boolean {
    const here = this.copies.filter((copy) => copy.boardId === boardId);
    const missing = assetIds.filter((assetId) => !here.some((copy) => copy.assetIds.has(assetId)));
    return missing.length === 0 || this.stored.wasCopiedFrom(missing, boardId);
  }
}
