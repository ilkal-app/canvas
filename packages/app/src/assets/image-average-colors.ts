import { rgbaSchema, type AssetId, type Rgba } from '@canvas/schema';

// The images' average colours on the page's thread: a stroke or text started over an
// image contrasts with the image's average colour, from its asset record. The creation tools ask
// synchronously at the press, so the colours are read ahead (`warm`, when a creation tool is
// chosen) and kept; an image whose record is not read yet, or whose average the service has not
// computed (`averageColor: null`), answers null, which the tools treat as a pending image: `ink`.

/** How long after a read that found no average colour the record may be read again, ms. */
export const AVERAGE_COLOR_RETRY_MS = 5000;

/** What {@link ImageAverageColors} reads records with. */
export interface ImageAverageColorsOptions {
  /** Reads an asset's record for the board; rejects when the board cannot read it. */
  readonly readRecord: (assetId: AssetId) => Promise<unknown>;
  /** The clock, ms; `performance.now` by default. */
  readonly now?: () => number;
}

/**
 * The average colour a record states, when it is a valid colour.
 *
 * @param record - The record, as the service sent it.
 * @returns The colour, or null.
 */
function averageColorOf(record: unknown): Rgba | null {
  if (typeof record !== 'object' || record === null) return null;
  const parsed = rgbaSchema.safeParse((record as { readonly averageColor?: unknown }).averageColor);
  return parsed.success ? parsed.data : null;
}

/**
 * The page's cache of images' average colours, filled from their asset records (one read per
 * asset at a time, again no sooner than {@link AVERAGE_COLOR_RETRY_MS} after one found none).
 * Page.
 */
export class ImageAverageColors {
  private readonly colors = new Map<string, Rgba>();
  private readonly reading = new Set<string>();
  private readonly lastMissMs = new Map<string, number>();
  private readonly now: () => number;

  /**
   * Knows no colour yet.
   *
   * @param options - The record read and the clock.
   */
  constructor(private readonly options: ImageAverageColorsOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  /**
   * An image's average colour, as the creation tools ask at a press (a bound function): the
   * colour when known, else null, and its record is read for the next press.
   *
   * @param assetId - The image's asset.
   * @returns The colour, or null while it is not known.
   */
  readonly averageColorOf = (assetId: string): Rgba | null => {
    const color = this.colors.get(assetId);
    if (color !== undefined) return color;
    this.read(assetId);
    return null;
  };

  /**
   * Reads ahead the records of images whose colours are not known.
   *
   * @param assetIds - The images' assets.
   */
  warm(assetIds: Iterable<string>): void {
    for (const assetId of assetIds) if (!this.colors.has(assetId)) this.read(assetId);
  }

  /**
   * Reads one record unless a read is under way or one found no colour moments ago.
   *
   * @param assetId - The asset.
   */
  private read(assetId: string): void {
    if (this.reading.has(assetId)) return;
    const missedMs = this.lastMissMs.get(assetId);
    if (missedMs !== undefined && this.now() - missedMs < AVERAGE_COLOR_RETRY_MS) return;
    this.reading.add(assetId);
    this.options.readRecord(assetId as AssetId).then(
      (record) => {
        this.settle(assetId, averageColorOf(record));
      },
      () => {
        this.settle(assetId, null);
      },
    );
  }

  /**
   * Keeps what a read found.
   *
   * @param assetId - The asset.
   * @param color - Its average colour, or null for none.
   */
  private settle(assetId: string, color: Rgba | null): void {
    this.reading.delete(assetId);
    if (color === null) this.lastMissMs.set(assetId, this.now());
    else {
      this.colors.set(assetId, color);
      this.lastMissMs.delete(assetId);
    }
  }
}
