import type { BoardObject } from '@canvas/schema';
import { replaceFontFamilyOnBoard, restyleTextObjects, type TextModeContext } from '@canvas/tools';

import {
  missingObjectFonts,
  readFontReplacement,
  setFontReplacement,
} from '../text-input/font-replacement.js';
import { ensurePageFont } from '../text-input/page-fonts.js';

import { afterStoreIdle } from './after-store-idle.js';

// The font replacement requests `DocumentText` opens: an edit of a text whose
// font is missing asks for a replacement of that text's families; the missing-fonts notice asks
// for the board-wide replacement of one family. Both load the picked font first and give up when
// the request was replaced meanwhile, the owner was destroyed or the person may no longer edit.

/** What a replacement request works with. */
export interface FontReplacementHost {
  /** The request's owner, which closes it when destroyed. */
  readonly owner: object;
  /** Whether a picked font may still be written: the owner lives and the person may edit. */
  readonly canWrite: () => boolean;
  /** The text tools' context the replacement writes through. */
  readonly context: () => TextModeContext;
}

/**
 * Loads the picked font, waits for no stepped run to hold the store, then writes the
 * replacement if the request still stands.
 *
 * @param host - The owner, whether it may write, and the context.
 * @param family - The picked family.
 * @param write - Writes the replacement; answers whether it did.
 * @returns Whether the replacement was written.
 */
async function replaceWhenLoaded(
  host: FontReplacementHost,
  family: string,
  write: () => boolean,
): Promise<boolean> {
  const request = readFontReplacement();
  if (!(await ensurePageFont(family))) return false;
  await afterStoreIdle({ store: host.context().store });
  if (!host.canWrite() || readFontReplacement() !== request) return false;
  return write();
}

/**
 * Whether a text may be edited now: true when its fonts are available; else it asks for a
 * replacement of its missing families (the picked font restyles the text whole) and answers false.
 *
 * @param host - The owner, whether it may write, and the context.
 * @param object - The text about to be edited.
 * @returns Whether editing may start.
 */
export function canEditTextFonts(host: FontReplacementHost, object: BoardObject): boolean {
  const families = missingObjectFonts(object);
  if (families.length === 0) return true;
  setFontReplacement({
    owner: host.owner,
    families,
    replace: (family) =>
      replaceWhenLoaded(host, family, () => {
        const context = host.context();
        const latest = context.store.get(object.id);
        if (latest === undefined || latest.locked) return false;
        restyleTextObjects(context, [object.id], { fontFamily: family });
        return true;
      }),
  });
  return false;
}

/**
 * Opens the board-wide replacement of a missing family (the missing-fonts notice's
 * Replace…): the picked font replaces the family everywhere the board names it in one undo step
 * (`replaceFontFamilyOnBoard`); closing the dialog changes nothing.
 *
 * @param host - The owner, whether it may write, and the context.
 * @param family - The missing family, as the board stores it.
 */
export function openBoardFontReplacement(host: FontReplacementHost, family: string): void {
  setFontReplacement({
    owner: host.owner,
    families: [family],
    scope: 'board',
    replace: (to) =>
      replaceWhenLoaded(host, to, () => {
        replaceFontFamilyOnBoard(host.context(), family, to);
        return true;
      }),
  });
}
