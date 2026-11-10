import type { NewObject } from '@canvas/document';
import { isImagePaint, type AssetId, type Board } from '@canvas/schema';

import { MAX_ASSETS_PER_COPY } from '../assets/copied-assets.js';
import { CROSS_BOARD_TOO_MANY_MESSAGE } from '../assets/copy-ledger.js';
import {
  CROSS_BOARD_NOT_COPIED_MESSAGE,
  CROSS_BOARD_UNAVAILABLE_MESSAGE,
} from '../assets/page-images.js';

import {
  CANVAS_BOARD_MIME_TYPE,
  EMBEDDED_BOARD_ATTRIBUTE,
  HTML_MIME_TYPE,
} from './clipboard-formats.js';
import type { PasteItem, PasteTarget } from './paste-handlers.js';

/**
 * The image assets a board shows, each once: its images', its shapes' and frames' image paints',
 * and those its instances' overrides put in place of a main's image (rule 3,
 * any path), so a copy records and a paste links them as it does an image object.
 *
 * @param board - The board: a copy, or a paste.
 * @returns The asset ids.
 */
export function imageAssetsOf(board: Board): AssetId[] {
  const assets = new Set<AssetId>();
  for (const object of board.objects.values()) {
    if (object.type === 'image') assets.add(object.assetId);
    // An image paint on a shape's fill or a frame's background shows its asset too.
    const paint =
      object.type === 'shape' ? object.fill : object.type === 'frame' ? object.background : null;
    if (isImagePaint(paint)) assets.add(paint.assetId);
    if (object.type !== 'instance') continue;
    for (const record of Object.values(object.overrides)) {
      if (record.assetId !== undefined) assets.add(record.assetId);
    }
  }
  return [...assets];
}

/**
 * The board a paste's items were copied from, as the clipboard claims it: the board flavour,
 * else the attribute the canvas writes on its HTML's root element. A claim only, like everything
 * on the clipboard (any web page can write it): a paste acts on it only for images this browser
 * copied from that board (`CopiedAssets`).
 *
 * @param items - The paste's items.
 * @param readAttribute - Reads the HTML's attribute (a `DOMParser` on the page).
 * @returns The board's id, or undefined.
 */
export function sourceBoardOf(
  items: readonly PasteItem[],
  readAttribute: (html: string, attribute: string) => string | undefined,
): string | undefined {
  const text = (type: string) => {
    const item = items.find((candidate) => candidate.kind === 'string' && candidate.type === type);
    return item?.kind === 'string' ? item.data : undefined;
  };
  const flavour = text(CANVAS_BOARD_MIME_TYPE)?.trim();
  if (flavour !== undefined && flavour !== '') return flavour;
  const html = text(HTML_MIME_TYPE);
  return html === undefined ? undefined : readAttribute(html, EMBEDDED_BOARD_ATTRIBUTE);
}

/**
 * Creates a pasted board's objects, linking its images to the target board first when they
 * were copied from another board (owner-confirmed proof of possession): pasting onto a
 * page that knows no board needs no call; from another board, every image's asset is linked
 * with that board's token before anything is written, and a link that is refused or cannot be
 * asked for (no token for the source board, an unknown source) creates nothing and tells the
 * person why.
 *
 * The clipboard's source board is only a claim (any web page can write it), so the
 * person is told to copy again, and nothing is created, unless this browser's record of its own
 * copies vouches for it: from another board, every image's asset must be recorded under the
 * claimed board (also enforced by `PasteImages.linkFrom`, which no handler can bypass); a claim
 * of this very board is taken only for assets the record holds for this board or the board's
 * document already shows, since no link is made then and a forged asset would draw as
 * unavailable. No token is fetched and no request is made for a claim the record does not
 * vouch for.
 *
 * @param board - The pasted board.
 * @param objects - Its objects as the paste places them.
 * @param target - Where the paste goes.
 * @param create - Creates the objects.
 */
export function createLinkedPaste(
  board: Board,
  objects: readonly NewObject[],
  target: PasteTarget,
  create: (objects: readonly NewObject[]) => void,
): void {
  const assets = imageAssetsOf(board);
  const { boardId, images } = target;
  if (assets.length === 0 || boardId === undefined) {
    create(objects);
    return;
  }
  // Read only now: without a board flavour it parses the whole HTML.
  const { sourceBoard } = target;
  if (sourceBoard === boardId) {
    // One pass over the board and one read of the record for the whole paste.
    const shown = target.shownImagesAmong?.(assets) ?? new Set<AssetId>();
    const unshown = assets.filter((asset) => !shown.has(asset));
    const isHeld = unshown.length === 0 || images?.wasCopiedFrom(unshown, boardId) === true;
    if (isHeld) create(objects);
    else target.notify(CROSS_BOARD_NOT_COPIED_MESSAGE);
    return;
  }
  if (sourceBoard === undefined || images === undefined) {
    target.notify(CROSS_BOARD_UNAVAILABLE_MESSAGE);
    return;
  }
  if (!images.wasCopiedFrom(assets, sourceBoard)) {
    // The count is the pasted objects' own, only used to choose the sentence.
    const isTooMany = assets.length > MAX_ASSETS_PER_COPY;
    target.notify(isTooMany ? CROSS_BOARD_TOO_MANY_MESSAGE : CROSS_BOARD_NOT_COPIED_MESSAGE);
    return;
  }
  // A link already asked for may finish after a later paste superseded this one: then
  // it creates and tells nothing.
  images.linkFrom(assets, sourceBoard).then(
    () => {
      if (target.isCurrent?.() !== false) create(objects);
    },
    (error: unknown) => {
      if (target.isCurrent?.() === false) return;
      const isSentence = error instanceof Error && error.message !== '';
      target.notify(isSentence ? error.message : CROSS_BOARD_UNAVAILABLE_MESSAGE);
    },
  );
}
