import { parseRunsPayload } from '@canvas/tools';

import { isOverPasteLimit } from '../clipboard/clipboard-notice.js';
import type { PasteHandler } from '../clipboard/paste-handlers.js';
import { newTextObject } from '../clipboard/pasted-text.js';

/**
 * Where the runs flavour stands among the paste handlers: under the canvas's own objects (300),
 * which carry whole objects, and over HTML (100) and plain text (0), which lose run styles.
 */
export const RUNS_PASTE_PRIORITY = 200;

/**
 * Pastes the text editor's styled flavour (`application/x-canvas-runs+json`, `{ text, runs }`
 * and any list `paragraphs`) outside the editor as a new text object with those runs, at the pointer (the view's
 * centre while the pointer is off the canvas). The payload is validated, never trusted
 * (`parseRunsPayload`); a malformed or oversized one lets the next flavour (HTML, plain text)
 * try. Inside the editor the text input bridge takes the paste first, so this runs only for a
 * paste onto the board.
 *
 * @param item - The clipboard item.
 * @param target - Where the paste goes.
 * @returns Whether the paste is handled.
 */
export const pasteRunsFlavour: PasteHandler = (item, target) => {
  if (item.kind !== 'string' || isOverPasteLimit(item.type, item.data)) return false;
  const payload = parseRunsPayload(item.data);
  if (payload === undefined) return false;
  // Its paragraph styles too: a copied list pastes as a list.
  const { paragraphs } = payload;
  const content = {
    text: payload.text,
    runs: [...payload.runs],
    ...(paragraphs === undefined ? {} : { paragraphs: [...paragraphs] }),
  };
  const object = newTextObject(content, target.pointer ?? target.viewCentre);
  // A refusal is told by the paste location, with its count.
  target.createObjects([object]);
  return true;
};
