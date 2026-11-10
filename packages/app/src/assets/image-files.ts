import { boardTokenPlanOf } from '../collab/board-token-plan.js';

/**
 * The image types the board takes: what browsers decode and
 * the assets service accepts (`ACCEPTED_IMAGE_TYPES` of `@canvas/assets`: JPEG, PNG, WebP, AVIF
 * and GIF, whose levels are its first frame; the engine plays an animated GIF on screen from its
 * original).
 */
export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
];

/** The largest image file taken, bytes: the assets service's default `MAX_UPLOAD_BYTES`. */
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

/** The most pixels an image may have: the assets service's `MAX_INPUT_PIXELS` (64 megapixels). */
export const MAX_IMAGE_PIXELS = 64_000_000;

/** What of a file the checks read. */
export interface ImageFileFacts {
  /** The file's name, for the notice. */
  readonly name: string;
  /** Its media type, as the browser reports it; may be empty. */
  readonly type: string;
  /** Its size, bytes. */
  readonly size: number;
}

/** Why a file is not taken, as a sentence for the person; `undefined` when it is taken. */
export type ImageFileRefusal = string | undefined;

/**
 * The name a notice calls a file by: its own, or "The image" for a pasted one without a name.
 *
 * @param file - The file.
 * @returns The name, quoted.
 */
/**
 * A byte count in MB as the board's messages name it: 1024² bytes, rounded down.
 *
 * @param bytes - The count.
 * @returns Its whole MB.
 */
export function megabytes(bytes: number): string {
  return Math.floor(bytes / (1024 * 1024)).toLocaleString('en-US');
}

function nameOf(file: ImageFileFacts): string {
  return file.name === '' ? 'The image' : `“${file.name}”`;
}

/**
 * Checks a file before anything is read or uploaded (refused before upload with a clear notice):
 * its type must be one of {@link ACCEPTED_IMAGE_TYPES} and its size at most
 * {@link MAX_IMAGE_BYTES}. Pure.
 *
 * @param file - The file's name, type and size.
 * @param uploadBytes - The board's plan's largest upload, from its board token; the
 *   board's own 100 MB without one.
 * @returns Why it is refused, or undefined.
 */
export function refuseImageFile(file: ImageFileFacts, uploadBytes?: number): ImageFileRefusal {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type.toLowerCase())) {
    return `${nameOf(file)} is not an image the board can show: use JPEG, PNG, WebP, AVIF or GIF.`;
  }
  if (uploadBytes !== undefined && uploadBytes < MAX_IMAGE_BYTES && file.size > uploadBytes) {
    return `${nameOf(file)} is larger than ${megabytes(uploadBytes)} MB, the most this board's plan takes.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${nameOf(file)} is larger than 100 MB, the most the board takes.`;
  }
  if (file.size === 0) return `${nameOf(file)} is empty.`;
  return undefined;
}

/**
 * The sentence for an image with more than {@link MAX_IMAGE_PIXELS} pixels, which the assets
 * service would refuse after the upload (the prepare worker reads the size from the header).
 *
 * @param file - The file.
 * @returns The sentence.
 */
export function tooManyPixelsNotice(file: ImageFileFacts): string {
  return `${nameOf(file)} has more than 64 megapixels, the most the board takes.`;
}

/**
 * The sentence for a file the browser could not read as an image.
 *
 * @param file - The file.
 * @returns The sentence.
 */
export function unreadableImageNotice(file: ImageFileFacts): string {
  return `${nameOf(file)} could not be read as an image.`;
}

/**
 * The board's plan's largest upload, from a board token's `ent` claim. The token is
 * read, not verified: the assets service checks the size again, and this only spares a doomed
 * upload.
 *
 * @param token - The board token, if held.
 * @returns The bytes, or undefined when the token names no limit.
 */
export function planUploadBytesOf(token: string | undefined): number | undefined {
  const bytes = boardTokenPlanOf(token)?.uploadBytes;
  return Number.isSafeInteger(bytes) && (bytes as number) > 0 ? (bytes as number) : undefined;
}
