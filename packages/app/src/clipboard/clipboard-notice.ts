/**
 * Why the clipboard did less than asked, internal to the clipboard: the person is told the
 * message, through the engine's `onNotice`.
 *
 *
 * - `cut-locked`: the selection holds a locked object, which cut would not delete, so nothing was
 *   cut and the clipboard is untouched.
 * - `paste-too-large`: every flavour is over its paste limit, or the objects are more than
 *   `MAX_PASTE_OBJECTS`, so nothing was pasted.
 * - `paste-mid-drag`: a paste arrived while a drag was under way; nothing was pasted.
 * - `paste-refused`: the board refused the pasted objects (the `createObjects` command was
 *   rejected), so nothing was pasted.
 * - `clipboard-unavailable`: the system clipboard refused a read or write; the copy is kept in
 *   the page, so a paste in this page still works.
 * - `paste-newer-version`: the objects were copied from a newer version of the canvas, whose
 *   schema this page does not know; nothing was pasted, and no other flavour was used.
 */
export const CLIPBOARD_NOTICE_CODES = [
  'cut-locked',
  'paste-too-large',
  'paste-mid-drag',
  'paste-refused',
  'clipboard-unavailable',
  'paste-newer-version',
] as const;

/** What the person is told when the board refuses what a paste would create (`paste-refused`). */
export const PASTE_REFUSED_MESSAGE = 'The board could not take what was pasted.';

/** The notice of objects copied from a newer version of the canvas (`paste-newer-version`). */
export const NEWER_VERSION_NOTICE: ClipboardNotice = {
  code: 'paste-newer-version',
  message: 'This was copied from a newer version of Ilkal. Reload to paste it.',
};

/** One of {@link CLIPBOARD_NOTICE_CODES}. */
export type ClipboardNoticeCode = (typeof CLIPBOARD_NOTICE_CODES)[number];

/** A clipboard notice: what happened, for code and for people. */
export interface ClipboardNotice {
  /** What kind of notice. */
  readonly code: ClipboardNoticeCode;
  /** A sentence for the person. */
  readonly message: string;
}

/**
 * The limit of a paste's plain text, in UTF-16 code units (2 MiB): parsing and laying out more on
 * the main thread would stall the page. A flavour over its limit is skipped, so a smaller flavour
 * of the same paste can still be pasted; a paste whose every flavour is over is refused with a
 * `paste-too-large` notice.
 */
export const MAX_PASTE_TEXT_LENGTH = 2 * 1024 * 1024;

/**
 * The limit of a paste's markup (HTML, and the canvas's objects JSON), in UTF-16 code units
 * (4 MiB): twice the plain-text limit (see {@link MAX_PASTE_TEXT_LENGTH}), since the canvas's own
 * HTML embeds the objects as escaped JSON, 1.2–2 times the JSON's size. What bounds a paste of
 * objects is {@link MAX_PASTE_OBJECTS}; this only keeps the JSON from being parsed at all when it
 * is far too long.
 */
export const MAX_PASTE_MARKUP_LENGTH = 4 * 1024 * 1024;

/** The most objects one paste creates; a larger objects payload is refused with a notice. */
export const MAX_PASTE_OBJECTS = 5_000;

/** The notice of a paste whose every flavour is over its limit. */
export const TOO_LARGE_NOTICE: ClipboardNotice = {
  code: 'paste-too-large',
  message: 'The clipboard holds too much to paste.',
};

/**
 * Tells whether a string flavour is over its paste limit: markup (`text/html`, the canvas's
 * objects) over {@link MAX_PASTE_MARKUP_LENGTH}, anything else (plain text) over
 * {@link MAX_PASTE_TEXT_LENGTH}.
 *
 * @param type - The flavour's MIME type.
 * @param data - Its data.
 * @returns Whether it is over.
 */
export function isOverPasteLimit(type: string, data: string): boolean {
  const isMarkup = type === 'text/html' || type === 'application/x-canvas-objects+json';
  return data.length > (isMarkup ? MAX_PASTE_MARKUP_LENGTH : MAX_PASTE_TEXT_LENGTH);
}
