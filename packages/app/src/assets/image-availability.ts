import type { AssetId } from '@canvas/schema';

import { AssetsHttpError } from './assets-responses.js';

/**
 * Whether the board can show an image's asset: `available` (the board is linked to it),
 * `unfinished` (the service does not let the board read it, and this page began uploading it:
 * its upload never finished), `missing` (the service does not let the board read it, and this
 * page has no record of uploading it: it may belong to another board, be unknown, or be a
 * collaborator's upload still going), `uploading` (this page is uploading it) or `unknown` (the
 * service could not say).
 */
export type ImageAvailability = 'available' | 'unfinished' | 'missing' | 'uploading' | 'unknown';

/** What {@link ImageAvailabilityCheck} asks the service with. */
export interface ImageAvailabilityOptions {
  /** Reads an asset's record for the board (rejects `404` when the board cannot read it). */
  readonly readRecord: (assetId: AssetId) => Promise<unknown>;
  /** Whether this page is uploading an asset. */
  readonly isUploading: (assetId: AssetId) => boolean;
  /** Whether this page began uploading an asset, in this session; never by default. */
  readonly hasUploaded?: (assetId: AssetId) => boolean;
}

/**
 * Asks the assets service whether the board can show an image (fix round 1): after a
 * reload, a failed or abandoned upload leaves an image object the board is not linked to, which
 * draws its placeholder for good; the style panel says so for the selected image and offers
 * Remove (a retry needs the file, which is gone). One record request per check, when a person
 * selects an image; an available asset is remembered, a missing one asked again next time (a
 * collaborator's upload may finish). Page.
 */
export class ImageAvailabilityCheck {
  private readonly available = new Set<AssetId>();

  /**
   * Checks nothing yet.
   *
   * @param options - The record read and the page's uploads.
   */
  constructor(private readonly options: ImageAvailabilityOptions) {}

  /**
   * Reads an asset's record for the board, as the checks do (a bound function), for other
   * readers of records on the page: the images' average colours (`ImageAverageColors`).
   *
   * @param assetId - The asset.
   * @returns The record; rejects when the board cannot read it.
   */
  readonly readRecord = (assetId: AssetId): Promise<unknown> => this.options.readRecord(assetId);

  /**
   * Whether the board can show an asset (a bound function: one reference per check, which a
   * React effect can depend on).
   *
   * @param assetId - The asset.
   * @returns Its availability; never rejects.
   */
  readonly availabilityOf = async (assetId: AssetId): Promise<ImageAvailability> => {
    if (this.options.isUploading(assetId)) return 'uploading';
    if (this.available.has(assetId)) return 'available';
    try {
      await this.options.readRecord(assetId);
      this.available.add(assetId);
      return 'available';
    } catch (error) {
      if (!(error instanceof AssetsHttpError) || error.status !== 404) return 'unknown';
      return this.options.hasUploaded?.(assetId) === true ? 'unfinished' : 'missing';
    }
  };
}
