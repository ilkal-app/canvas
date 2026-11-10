import type { TextLayout } from '@canvas/engine';

import { listParagraphsOf } from './paragraph-edits.js';
import type { EditableTextObject } from './text-box-object.js';
import { editedPlacementOf, layoutContent, type TextContent } from './text-content-writer.js';
import type { TextModeContext } from './text-mode-context.js';

/**
 * An editing session's layout of the text it shows, laid out on the page again only when the
 * shown content (the composition included) or the box changes: a caret move or a hover reuses
 * it. Main thread; no DOM.
 */
export class SessionLayoutCache {
  private cached: { readonly key: string; readonly layout: TextLayout | undefined } | undefined;

  /**
   * The layout of content shown in a box.
   *
   * @param context - The mode's context, for the page's layout.
   * @param object - The text object, note or shape whose box it is.
   * @param shown - The content as shown.
   * @returns The layout, or `undefined` while no font is loaded.
   */
  layoutOf(
    context: Pick<TextModeContext, 'layout'>,
    object: EditableTextObject,
    shown: TextContent,
  ): TextLayout | undefined {
    const { wrapWidth, align, boxHeight } = editedPlacementOf(object);
    // A note's text is fitted to its box, so its height is part of the key too.
    const fitHeight = object.type === 'sticky' ? boxHeight : null;
    const lists = listParagraphsOf(shown);
    const key = JSON.stringify([
      shown.text,
      shown.runs,
      wrapWidth,
      align,
      fitHeight,
      lists ?? null,
    ]);
    // No layout (no font yet) is not kept, so the text is laid out once the fonts land.
    if (this.cached?.key !== key || this.cached.layout === undefined) {
      this.cached = { key, layout: layoutContent(context, object, shown) };
    }
    return this.cached.layout;
  }
}
