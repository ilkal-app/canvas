import type { ClipboardAccess } from './clipboard-access.js';
import type { ClipboardMemory } from './clipboard-memory.js';
import type { ClipboardNotice } from './clipboard-notice.js';
import type { ClipboardSource } from './clipboard-source.js';
import type { PasteItem } from './paste-handlers.js';

/** A clipboard command asked for as an action rather than a native shortcut. */
export type ClipboardActionCommand = 'copy' | 'cut' | 'paste';

/** What a clipboard action works with. */
export interface ClipboardActionContext {
  /** The engine's clipboard side. */
  readonly source: ClipboardSource;
  /** The system clipboard (the async Clipboard API). */
  readonly access: ClipboardAccess;
  /** The page's own clipboard, which keeps every copy. */
  readonly memory: ClipboardMemory;
  /**
   * Offers paste items to the router's handlers.
   *
   * @param items - The items.
   */
  readonly paste: (items: readonly PasteItem[]) => void;
  /**
   * Tells the person what the clipboard could not do.
   *
   * @param notice - The notice.
   */
  readonly notify: (notice: ClipboardNotice) => void;
}

/** The notice when the system clipboard refuses a read or write. */
const UNAVAILABLE: ClipboardNotice = {
  code: 'clipboard-unavailable',
  message: 'The system clipboard is not available; the copy is kept for pasting in this page.',
};

/**
 * Writes flavours to the system clipboard, keeping them in the page's memory first, so a refused
 * write loses nothing: a paste in this page then reads the memory.
 *
 * @param flavours - The flavours.
 * @param context - The clipboard.
 * @returns Settles once written or refused (with a notice).
 */
async function write(
  flavours: Parameters<ClipboardAccess['write']>[0],
  context: ClipboardActionContext,
): Promise<void> {
  context.memory.remember(flavours, false);
  try {
    await context.access.write(flavours);
    context.memory.remember(flavours, true);
  } catch {
    context.notify(UNAVAILABLE);
  }
}

/**
 * Reads what a paste takes: the page's own copy when the system clipboard does not hold it, else
 * the system clipboard, falling back to the page's copy when the system refuses the read.
 *
 * @param context - The clipboard.
 * @returns The items.
 */
async function read(context: ClipboardActionContext): Promise<readonly PasteItem[]> {
  const own = context.memory.itemsFor(false);
  if (own !== undefined) return own;
  try {
    return await context.access.read();
  } catch {
    const kept = context.memory.itemsFor(true);
    if (kept === undefined) context.notify(UNAVAILABLE);
    return kept ?? [];
  }
}

/**
 * Runs copy, cut or paste asked for as an action (a button, a menu), through the async Clipboard
 * API. A cut writes first and deletes the objects it copied only after the write has settled; the
 * page's memory keeps the copy either way, so a refused write never loses the cut objects. A
 * refused cut (a locked object) writes and deletes nothing.
 *
 * @param command - Copy, cut or paste.
 * @param context - The source, clipboards, handlers and notices.
 * @returns Settles when done.
 */
export async function runClipboardAction(
  command: ClipboardActionCommand,
  context: ClipboardActionContext,
): Promise<void> {
  if (command === 'paste') {
    context.paste(await read(context));
    return;
  }
  if (command === 'copy') {
    const flavours = context.source.copy();
    if (flavours !== undefined) await write(flavours, context);
    return;
  }
  const cut = context.source.prepareCut();
  if (cut.kind === 'refused') context.notify({ code: 'cut-locked', message: cut.message });
  if (cut.kind !== 'ready') return;
  await write(cut.flavours, context);
  cut.remove();
}
