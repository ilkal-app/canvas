/**
 * The canvas's own clipboard flavour: a
 * portable board (`exportBoard` of `@canvas/schema`) holding the copied objects with their
 * descendants, as JSON. Paste reads it through `importBoard`, never trusting it.
 */
export const CANVAS_OBJECTS_MIME_TYPE = 'application/x-canvas-objects+json';

/** Plain text: a copy writes the copied objects' text, one per line. */
export const PLAIN_TEXT_MIME_TYPE = 'text/plain';

/**
 * HTML: a copy writes the copied texts with their basic styles, for other apps, and embeds the
 * objects flavour in an attribute, so paths that keep only standard types (the async Clipboard
 * API, some browsers across tabs) still carry the objects.
 */
export const HTML_MIME_TYPE = 'text/html';

/** The attribute of a copy's HTML root element that holds the objects flavour. */
export const EMBEDDED_OBJECTS_ATTRIBUTE = 'data-canvas-objects';

/**
 * The board a copy was made on: its id as text, written beside the objects flavour, so
 * a paste of images into another board knows which board to link them from (owner-confirmed
 * proof of possession: an asset id alone grants nothing). Never a token: the clipboard is
 * readable by other apps.
 */
export const CANVAS_BOARD_MIME_TYPE = 'application/x-canvas-board';

/** The attribute of a copy's HTML root element that holds the board it was copied from. */
export const EMBEDDED_BOARD_ATTRIBUTE = 'data-canvas-board';

/** What a copy puts on the clipboard: data by MIME type, in the order it is written. */
export type ClipboardFlavours = ReadonlyMap<string, string>;
