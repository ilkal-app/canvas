import type { ClipboardFlavours } from './clipboard-formats.js';
import type { PasteTarget } from './paste-handlers.js';

/**
 * A cut, prepared but not done: the flavours to write and the delete to run once they are
 * written. A selection holding a locked object is not cut (the delete would leave the locked
 * object), so the cut is refused and the clipboard left untouched.
 */
export type PreparedCut =
  | {
      /** Nothing selected can be copied. */
      readonly kind: 'empty';
    }
  | {
      /** The cut is refused; nothing is written or deleted. */
      readonly kind: 'refused';
      /** Why, a sentence for the person. */
      readonly message: string;
    }
  | {
      /** The cut can go ahead. */
      readonly kind: 'ready';
      /** The selection's flavours, to write first. */
      readonly flavours: ClipboardFlavours;
      /**
       * Deletes the objects that were copied (as one delete command), those still on the board:
       * the ids are taken when the cut is prepared, not when this runs.
       */
      remove(): void;
    };

/** What a shell's clipboard acts on: its engine's selection and board. */
export interface ClipboardSource {
  /**
   * The selection as clipboard flavours.
   *
   * @returns The flavours, or `undefined` when nothing selected can be copied.
   */
  copy(): ClipboardFlavours | undefined;
  /**
   * Prepares a cut of the selection.
   *
   * @returns The prepared cut.
   */
  prepareCut(): PreparedCut;
  /**
   * Where a paste goes now, and where clipboard notices go (the engine's `onNotice`).
   *
   * @returns The target.
   */
  pasteTarget(): PasteTarget;
}
