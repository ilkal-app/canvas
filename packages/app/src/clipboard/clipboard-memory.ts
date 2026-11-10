import type { ClipboardFlavours } from './clipboard-formats.js';
import type { PasteItem } from './paste-handlers.js';

/** The page's last copy, and whether the system clipboard holds it too. */
interface RememberedCopy {
  /** The copy's flavours. */
  readonly flavours: ClipboardFlavours;
  /** Whether writing it to the system clipboard succeeded. */
  readonly isOnSystemClipboard: boolean;
}

/**
 * The page's own clipboard: the last copy or cut of any shell on the page. The system
 * clipboard can refuse a write (no permission, no user activation, no async Clipboard API), and a
 * cut must not lose its objects then; a paste asked for as an action (a button, a menu) reads this
 * copy while the system clipboard does not hold it, or cannot be read. Main thread.
 */
export class ClipboardMemory {
  private copy: RememberedCopy | undefined;

  /**
   * Keeps a copy.
   *
   * @param flavours - The copy's flavours.
   * @param isOnSystemClipboard - Whether the system clipboard holds them too.
   */
  remember(flavours: ClipboardFlavours, isOnSystemClipboard: boolean): void {
    this.copy = { flavours, isOnSystemClipboard };
  }

  /**
   * The last copy as paste items, when a paste should read it instead of the system clipboard.
   *
   * @param hasSystemFailed - Whether reading the system clipboard failed.
   * @returns The items, or `undefined` when the system clipboard is to be read (or nothing was
   *   copied in the page).
   */
  itemsFor(hasSystemFailed: boolean): PasteItem[] | undefined {
    const copy = this.copy;
    if (copy === undefined || (copy.isOnSystemClipboard && !hasSystemFailed)) return undefined;
    return [...copy.flavours].map(([type, data]) => ({ kind: 'string', type, data }));
  }
}

/** The page's clipboard memory, shared by every shell's clipboard. */
export const PAGE_CLIPBOARD_MEMORY = new ClipboardMemory();
