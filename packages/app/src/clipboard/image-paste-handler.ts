import { NO_IMAGES_MESSAGE } from '../assets/page-images.js';

import type { PasteHandler } from './paste-handlers.js';

/**
 * Where the image file handler sits among the paste handlers: above HTML (100), which often comes
 * with a copied image, below the canvas's objects flavour (300).
 */
export const IMAGE_PASTE_PRIORITY = 200;

/**
 * The paste handler for image files (registered for `image/*` in the default handlers):
 * it takes an image file at once and hands it to the page's images (`PasteLocation.images`),
 * which refuse what the board cannot take, place the image centred at the pointer (the view's
 * centre while the pointer is off the canvas), draw it from its bytes at once and upload it. A
 * page without an assets service takes the paste and says why nothing was placed.
 *
 * @returns The handler.
 */
export function createImagePasteHandler(): PasteHandler {
  return (item, target) => {
    if (item.kind !== 'file') return false;
    if (target.images === undefined) target.notify(NO_IMAGES_MESSAGE);
    else target.images.insert([item.file], target.pointer ?? target.viewCentre);
    return true;
  };
}
