import type { AssetId, Point } from '@canvas/schema';
import { placeImages } from '@canvas/tools';

import { afterStoreIdle } from '../engine/after-store-idle.js';

import { linkedImageSize, linkProblemMessage, type PixelSize } from './link-images.js';
import type { ImageInsertTarget, PageImages } from './page-images.js';

// What the image panel does beyond Upload: an image from a link, fetched by the
// service. Recent images were dropped from v1 (of 2026-10-21).

/** An image the board can already show: its asset and its size. */
export interface BoardImage {
  readonly assetId: AssetId;
  readonly naturalSize: PixelSize;
}

/** What a link the service took says when its image never became readable. */
export const LINK_NOT_READ_MESSAGE = 'That image could not be read.';

/**
 * Places an image the board can already show, centred on a point, as one `createObjects`.
 *
 * @param image - Its asset and size.
 * @param at - Where it goes, world units.
 * @param target - Where it is created.
 * @returns False when it was refused at once or its page went meanwhile.
 */
export async function placeBoardImage(
  image: BoardImage,
  at: Point,
  target: ImageInsertTarget,
): Promise<boolean> {
  if (!(await afterStoreIdle(target))) return false;
  return target.createObjects(placeImages([image], at));
}

/**
 * Adds the image at a link, centred on a point: the service fetches it (it refuses private
 * addresses and anything but an image) and links it to the board, and the image is placed once
 * its size is known.
 *
 * @param images - The page's images.
 * @param url - The link the person gave.
 * @param at - Where it goes, world units.
 * @param target - Where it is created.
 * @returns False when it was refused at once or its page went meanwhile.
 * @throws {Error} With a sentence for the person when the link was refused or never read.
 */
export async function insertFromLink(
  images: Pick<PageImages, 'request'>,
  url: string,
  at: Point,
  target: ImageInsertTarget,
): Promise<boolean> {
  const record = await images
    .request((http) => http.fromLink(url))
    .catch((error: unknown) => {
      throw new Error(linkProblemMessage(error));
    });
  const naturalSize = await images
    .request((http) => linkedImageSize(http, record))
    .catch(() => undefined);
  if (naturalSize === undefined) throw new Error(LINK_NOT_READ_MESSAGE);
  return placeBoardImage({ assetId: record.id, naturalSize }, at, target);
}
