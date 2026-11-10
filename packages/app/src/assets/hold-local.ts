import type { AssetId } from '@canvas/schema';

import type { PageLink } from './asset-channel.js';
import type { ImageUploads } from './image-uploads.js';
import type { PreparedImage } from './prepare-image.js';

/** The longest the page waits for the adapter to hold a local image before creating it, ms. */
export const LOCAL_IMAGE_WAIT_MS = 1000;

/**
 * Hands an image's bytes to the engine's adapter and waits until it holds them (at most
 * {@link LOCAL_IMAGE_WAIT_MS}), so the engine draws the new objects from them at once instead
 * of asking the service, which cannot answer before the upload verifies.
 *
 * @param link - The page's link to the adapter, if any.
 * @param held - The images waited for, by asset: the adapter's `local-image-held` calls these.
 * @param image - The prepared image.
 * @param file - Its bytes.
 * @returns Settles once held, or after the wait, or at once without an adapter.
 */
export function holdLocalImage(
  link: PageLink | undefined,
  held: Map<AssetId, () => void>,
  image: PreparedImage,
  file: Blob,
): Promise<void> {
  if (link === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      held.delete(image.assetId);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, LOCAL_IMAGE_WAIT_MS);
    held.set(image.assetId, done);
    link.send({ type: 'local-image', image: { ...image, file } });
  });
}

/**
 * Tells a new engine's adapter of the page's uploads under way: each one's bytes, to
 * draw it from, and the verified ones (the board linked) to follow until their record settles,
 * whose status the badges wait for.
 *
 * @param link - The page's end of the new link.
 * @param uploads - The page's uploads.
 */
export function sendUnfinished(link: PageLink, uploads: ImageUploads): void {
  uploads.forEachUnfinished((image, file, isVerified) => {
    link.send({ type: 'local-image', image: { ...image, file } });
    if (isVerified) link.send({ type: 'uploaded', assetId: image.assetId });
  });
}
