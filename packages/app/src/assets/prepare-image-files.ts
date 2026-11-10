import { refuseImageFile, tooManyPixelsNotice, unreadableImageNotice } from './image-files.js';
import type { ImagePreparer, PreparedImage } from './prepare-image.js';

/** The sentence when the page's image reader (the prepare worker) failed to start or died. */
export const IMAGE_READER_FAILED_MESSAGE =
  'The images could not be read: the page’s image reader stopped. Try adding them again.';

/** A file read for upload, with what reading it gave. */
export interface PreparedFile {
  /** What the file is as an image. */
  readonly image: PreparedImage;
  /** Its bytes. */
  readonly file: File;
}

/**
 * Reads image files for upload off the page's thread (`PageImages`): refuses what the board
 * cannot take before reading it, and says why for each file left out (not an image, unreadable,
 * too many pixels) and once when the reader itself failed.
 *
 * @param files - The files.
 * @param preparer - Reads them, at most two at once.
 * @param notify - Receives a sentence for each file left out.
 * @param uploadBytes - The board's plan's largest upload, if known.
 * @returns The files read, in their order.
 */
export async function prepareImageFiles(
  files: readonly File[],
  preparer: ImagePreparer,
  notify: (message: string) => void,
  uploadBytes?: number,
): Promise<PreparedFile[]> {
  const taken = files.filter((file) => {
    const refusal = refuseImageFile(file, uploadBytes);
    if (refusal !== undefined) notify(refusal);
    return refusal === undefined;
  });
  // The preparer reads at most two at once; the rest wait in its queue.
  const outcomes = await Promise.all(taken.map((file) => preparer.prepare(file)));
  if (outcomes.some(({ status }) => status === 'reader-failed')) {
    notify(IMAGE_READER_FAILED_MESSAGE);
  }
  return taken.flatMap((file, index): PreparedFile[] => {
    const outcome = outcomes[index];
    if (outcome?.status === 'prepared') return [{ image: outcome.image, file }];
    if (outcome?.status === 'too-large') notify(tooManyPixelsNotice(file));
    else if (outcome?.status === 'unreadable') notify(unreadableImageNotice(file));
    return [];
  });
}
