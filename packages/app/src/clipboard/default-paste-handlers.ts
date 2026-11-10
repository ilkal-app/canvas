import type { NewObject } from '@canvas/document';
import { planPaste } from '@canvas/document';
import { RUNS_MIME_TYPE } from '@canvas/tools';

import { yieldToRendering } from '../engine/yield-to-rendering.js';
import { pasteRunsFlavour, RUNS_PASTE_PRIORITY } from '../text-input/runs-paste-handler.js';

import {
  decodeParsedObjects,
  decodeParsedObjectsInStages,
  objectCountOf,
  type ObjectsDecoding,
} from './clipboard-flavours.js';
import {
  CANVAS_OBJECTS_MIME_TYPE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
} from './clipboard-formats.js';
import {
  isOverPasteLimit,
  MAX_PASTE_OBJECTS,
  NEWER_VERSION_NOTICE,
  PASTE_REFUSED_MESSAGE,
} from './clipboard-notice.js';
import { embeddedObjectsOf, textFromHtml } from './html-flavour.js';
import { createImagePasteHandler, IMAGE_PASTE_PRIORITY } from './image-paste-handler.js';
import { LINK_PASTE_PRIORITY, pasteLinkCard } from './link-paste-handler.js';
import { createLinkedPaste } from './linked-paste.js';
import {
  PasteHandlerRegistry,
  type PasteHandler,
  type PasteHandlerOptions,
  type PasteTarget,
} from './paste-handlers.js';
import { newTextObject, PASTED_TEXT_STYLE, textContentOf } from './pasted-text.js';
import { trackPaste } from './pending-pastes.js';

/**
 * Creates the objects of a paste; the paste location tells the person of a refusal or a stop,
 * with its counts.
 *
 * @param objects - The objects as `createObjects` lists them.
 * @param target - Where the paste goes.
 * @returns `true`: the paste is handled either way.
 */
function create(objects: readonly NewObject[], target: PasteTarget): true {
  if (objects.length > 0) target.createObjects(objects);
  return true;
}

/** A paste of more objects than this is read in stages, the page drawing between them. */
export const STAGED_PASTE_OBJECTS = 500;

/** A staged paste was superseded by a later one, or its page ended: it does nothing more. */
class PasteSuperseded extends Error {
  /** Makes the error. */
  constructor() {
    super('A later paste superseded this one');
    this.name = 'PasteSuperseded';
  }
}

/**
 * Whether a paste is still the latest of its router (`PasteTarget.isCurrent`).
 *
 * @param target - Where the paste goes.
 * @returns False once a later paste began or the router ended.
 */
const isCurrent = (target: PasteTarget): boolean => target.isCurrent?.() !== false;

/**
 * Pastes a decoded objects flavour: a valid board at the pointer (or offset from where it was
 * copied), its images linked first when copied from another board (`createLinkedPaste`), more
 * objects than a paste creates refused with a notice, and objects copied from a newer version
 * refused with a notice to reload. Each ends the paste; an invalid payload or one over
 * its limit (`MAX_PASTE_MARKUP_LENGTH`) lets the next handler try.
 *
 * @param decoding - The decoded flavour.
 * @param target - Where the paste goes.
 * @returns Whether the paste is handled.
 */
function pasteDecoded(decoding: ObjectsDecoding, target: PasteTarget): boolean {
  if (decoding.kind === 'invalid' || decoding.kind === 'over-limit') return false;
  if (decoding.kind === 'newer') {
    target.notify(NEWER_VERSION_NOTICE.message);
    return true;
  }
  if (decoding.kind === 'too-many' || decoding.kind === 'refused') {
    target.notify(decoding.notice.message);
    return true;
  }
  createLinkedPaste(
    decoding.board,
    planPaste(decoding.board, target.pointer),
    target,
    (objects) => {
      if (isCurrent(target)) create(objects, target);
    },
  );
  return true;
}

/**
 * Pastes an objects flavour's text: read at once, or, for more than `STAGED_PASTE_OBJECTS`
 * objects, read in stages after this task, a later paste superseding it. A staged paste
 * is handled whatever it then finds, so an invalid one is told as refused, not passed on.
 *
 * @param json - The flavour's text.
 * @param target - Where the paste goes.
 * @returns Whether the paste is handled.
 */
function pasteObjectsText(json: string, target: PasteTarget): boolean {
  if (isOverPasteLimit(CANVAS_OBJECTS_MIME_TYPE, json)) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  const count = objectCountOf(parsed) ?? 0;
  // A paste of too many objects is refused at once, without reading them.
  if (count <= STAGED_PASTE_OBJECTS || count > MAX_PASTE_OBJECTS) {
    return pasteDecoded(decodeParsedObjects(parsed), target);
  }
  void trackPaste(pasteInStages(parsed, target));
  return true;
}

/**
 * Decodes and pastes a large objects flavour a stage at a time.
 *
 * @param parsed - The flavour's parsed JSON.
 * @param target - Where the paste goes.
 * @returns Settles once it is created, refused or superseded.
 */
async function pasteInStages(parsed: unknown, target: PasteTarget): Promise<void> {
  const stage = async (): Promise<void> => {
    await yieldToRendering();
    if (!isCurrent(target)) throw new PasteSuperseded();
  };
  try {
    await stage();
    const decoding = await decodeParsedObjectsInStages(parsed, stage);
    await stage();
    if (!pasteDecoded(decoding, target)) target.notify(PASTE_REFUSED_MESSAGE);
  } catch (error) {
    if (!(error instanceof PasteSuperseded)) throw error;
  }
}

/**
 * The canvas's own objects flavour: validated through `importBoard`, then pasted with new ids.
 *
 * @param item - The clipboard item.
 * @param target - Where the paste goes.
 * @returns Whether the paste is handled; `false` for a malformed or oversized payload, so
 *   another flavour can follow.
 */
const pasteObjects: PasteHandler = (item, target) =>
  item.kind === 'string' && pasteObjectsText(item.data, target);

/**
 * HTML: the objects a copy from the canvas embedded in it, else its text with basic styles as a
 * new text object at the pointer (the view's centre while the pointer is off the canvas). HTML
 * over `MAX_PASTE_MARKUP_LENGTH` is skipped, so the plain text can follow.
 *
 * @param item - The clipboard item.
 * @param target - Where the paste goes.
 * @returns Whether the paste is handled.
 */
const pasteHtml: PasteHandler = (item, target) => {
  if (item.kind !== 'string' || isOverPasteLimit(item.type, item.data)) return false;
  const embedded = embeddedObjectsOf(item.data);
  if (embedded !== undefined && pasteObjectsText(embedded, target)) return true;
  const content = textFromHtml(item.data);
  if (content === undefined) return false;
  return create([newTextObject(content, target.pointer ?? target.viewCentre)], target);
};

/**
 * Plain text as a new text object in the pasted-text style, at the pointer or the view's centre.
 *
 * @param item - The clipboard item.
 * @param target - Where the paste goes.
 * @returns Whether the paste is handled; `false` for blank text or text over
 *   `MAX_PASTE_TEXT_LENGTH`.
 */
const pastePlainText: PasteHandler = (item, target) => {
  if (item.kind !== 'string' || item.data.trim().length === 0) return false;
  if (isOverPasteLimit(item.type, item.data)) return false;
  const text = item.data.replaceAll('\r\n', '\n');
  const content = textContentOf([{ text, style: PASTED_TEXT_STYLE }]);
  if (content === undefined) return false;
  return create([newTextObject(content, target.pointer ?? target.viewCentre)], target);
};

/**
 * A registry holding the built-in paste handlers: the canvas's objects
 * flavour (priority 300), the text editor's styled runs (200), image files (`image/*`,
 * 200), HTML (100) and plain text (0).
 *
 * @returns The registry.
 */
export function createDefaultPasteHandlers(): PasteHandlerRegistry {
  const registry = new PasteHandlerRegistry();
  registry.register(CANVAS_OBJECTS_MIME_TYPE, pasteObjects, { priority: 300 });
  registry.register(RUNS_MIME_TYPE, pasteRunsFlavour, { priority: RUNS_PASTE_PRIORITY });
  registry.register('image/*', createImagePasteHandler(), { priority: IMAGE_PASTE_PRIORITY });
  // A lone web link becomes a card, before HTML or plain text read it.
  registry.register(PLAIN_TEXT_MIME_TYPE, pasteLinkCard, { priority: LINK_PASTE_PRIORITY });
  registry.register(HTML_MIME_TYPE, pasteHtml, { priority: 100 });
  registry.register(PLAIN_TEXT_MIME_TYPE, pastePlainText, { priority: 0 });
  return registry;
}

/**
 * The paste handlers every shell's clipboard router uses unless given others: the built-in ones,
 * plus whatever {@link registerPasteHandler} adds.
 */
export const DEFAULT_PASTE_HANDLERS: PasteHandlerRegistry = createDefaultPasteHandlers();

/**
 * Adds a paste handler for a MIME type or family (`image/*`) to every shell's clipboard router:
 * how later features take pastes of their own kinds (images) without listening to
 * clipboard events themselves.
 *
 * @param mimeType - The MIME type or family.
 * @param handler - The handler.
 * @param options - Its priority among the others.
 * @returns A function that removes it.
 */
export function registerPasteHandler(
  mimeType: string,
  handler: PasteHandler,
  options?: PasteHandlerOptions,
): () => void {
  return DEFAULT_PASTE_HANDLERS.register(mimeType, handler, options);
}
