import type { BoardObject, ObjectId } from '@canvas/schema';
import { previewTextObjects, type TextModeContext, type TextStylePatch } from '@canvas/tools';

/**
 * A style drag's preview of the selected text objects: each previewed object replaces
 * its document object on the canvas until the next preview, `end`, a document change or a new
 * selection. Main thread.
 */
export class TextStylePreview {
  /** The objects the preview shows, cleared when it ends. */
  private previewed: ObjectId[] = [];
  /** The selection the preview was made on. */
  private selection: readonly ObjectId[] | undefined;

  /**
   * Keeps what a preview writes to.
   *
   * @param setPreview - Shows an object as previewed, or drops the preview.
   */
  constructor(
    private readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void,
  ) {}

  /**
   * Shows the selected text objects restyled by a patch, laid out and measured, without writing.
   *
   * @param context - The document and layout the text is measured with.
   * @param selection - The selected objects.
   * @param patch - The fields the drag would set.
   */
  show(context: TextModeContext, selection: readonly ObjectId[], patch: TextStylePatch): void {
    const objects = previewTextObjects(context, selection, patch);
    const shown = new Set(objects.map(({ id }) => id));
    for (const id of this.previewed) if (!shown.has(id)) this.setPreview(id, undefined);
    for (const object of objects) this.setPreview(object.id, object);
    this.previewed = [...shown];
    this.selection = selection;
  }

  /**
   * Ends the preview when the selection is no longer the one it was made on.
   *
   * @param selection - The selection now.
   */
  selectionChanged(selection: readonly ObjectId[]): void {
    if (selection !== this.selection) this.end();
  }

  /** Clears every object the preview set, showing the document again. */
  end(): void {
    for (const id of this.previewed) this.setPreview(id, undefined);
    this.previewed = [];
    this.selection = undefined;
  }
}
