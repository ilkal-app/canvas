import { runCommand, setTextRunsCommand } from '@canvas/document';
import {
  connectorLabelPlacement,
  fitNoteText,
  noteBoxHeight,
  noteHeightFor,
  noteMinHeight,
  shapeLabelPlacement,
  textPlacementOf,
  type TextBoxGeometry,
  type TextLayout,
} from '@canvas/engine';
import type { ObjectId, ParagraphStyle, StyleRun } from '@canvas/schema';

import { listParagraphsOf } from './paragraph-edits.js';
import {
  isEditableTextObject,
  isLabelledObject,
  type EditableTextObject,
  type TextBoxObject,
} from './text-box-object.js';
import type { TextModeContext } from './text-mode-context.js';

/** The smallest width or height a text box is written with, world units (the schema wants > 0). */
export const MIN_TEXT_BOX_SIZE = 1;

/** Characters and runs, as the editor holds them. */
export interface TextContent {
  /** The characters. */
  readonly text: string;
  /** Their runs. */
  readonly runs: readonly StyleRun[];
  /** One style per paragraph; all plain when absent. */
  readonly paragraphs?: readonly ParagraphStyle[] | undefined;
}

/**
 * Where an edited object's text is laid out, exactly as the engine's text pass places it
 * (`textPlacementOf`): a text object's whole box, a sticky note's inside its padding, a shape's
 * label centred in the box inscribed in its kind (`shapeLabelPlacement`), a connector's
 * centred halfway along the route it was placed with (`connectorLabelPlacement`: the
 * editing session hands a placed connector), a label not written yet included. Pure.
 *
 * @param object - The text, note, shape or connector.
 * @returns Its text box, in the object's frame.
 */
export function editedPlacementOf(object: EditableTextObject): TextBoxGeometry {
  if (object.type === 'shape') return shapeLabelPlacement(object);
  if (object.type === 'connector') {
    return connectorLabelPlacement(object, object.label ?? { text: '', runs: [] });
  }
  return textPlacementOf(object);
}

/**
 * The width a text box's content wraps at, as the engine's text pass lays it out
 * (`textPlacementOf`): a sticky note's width inside its padding, a fixed-width text's width, a
 * shape label's inscribed box, none for auto-width text.
 *
 * @param object - The text, note or shape.
 * @returns The wrapping width, world units, or `null`.
 */
export function wrapWidthOf(object: EditableTextObject): number | null {
  return editedPlacementOf(object).wrapWidth;
}

/**
 * Lays an object's text out as the engine would: wrapping at its width unless auto-width, a
 * sticky note inside its padding with its text fitted to the note (`fitNoteText`: the
 * layout of the runs at the size they are drawn at, so the caret sits on the drawn glyphs), a
 * shape's label centred inside the shape.
 *
 * @param context - The mode's context, for the page's layout.
 * @param object - The text, note or shape.
 * @param content - The content to lay out in it.
 * @returns The layout, or `undefined` while no font is loaded.
 */
export function layoutContent(
  context: Pick<TextModeContext, 'layout'>,
  object: EditableTextObject,
  content: TextContent,
): TextLayout | undefined {
  const { wrapWidth, align } = editedPlacementOf(object);
  const layoutAt = (runs: readonly StyleRun[]): TextLayout | undefined =>
    context.layout.layout({
      text: content.text,
      runs,
      wrapWidth,
      align,
      paragraphs: listParagraphsOf(content),
    });
  const stored = layoutAt(content.runs);
  // No font yet, or not a note: nothing to fit.
  if (object.type !== 'sticky' || stored === undefined) return stored;
  return fitNoteText(
    { text: content.text, runs: content.runs, boxHeight: noteBoxHeight(object.height) },
    (runs) => layoutAt(runs) ?? stored,
  ).layout;
}

/**
 * The box size a text box is written with for some content: an auto-width box as wide as its
 * longest line, a fixed-width box keeping its width, as tall as the text; a sticky note keeping
 * its width and its height (at least its aspect's least; a note the person made taller keeps
 * that height), its text fitted to it, and growing (`noteHeightFor`) only when
 * the fitted text is still taller than its text box, which is the fit overflowing at its floor.
 * Never below {@link MIN_TEXT_BOX_SIZE}.
 *
 * @param object - The text or note, with its stored size.
 * @param layout - The content's layout; for a sticky note its fitted layout ({@link layoutContent}).
 * @returns The size, world units.
 */
export function measuredSize(
  object: TextBoxObject,
  layout: TextLayout,
): {
  /** The box's width, world units. */
  readonly width: number;
  /** The box's height, world units. */
  readonly height: number;
} {
  const width = object.type === 'text' && object.autoWidth ? layout.width : object.width;
  const height = object.type === 'sticky' ? noteHeightOf(object, layout) : layout.height;
  return {
    width: Math.max(MIN_TEXT_BOX_SIZE, width),
    height: Math.max(MIN_TEXT_BOX_SIZE, height),
  };
}

/**
 * A sticky note's measured height for its fitted text (see {@link measuredSize}).
 *
 * @param note - The note, with its stored size and aspect.
 * @param layout - Its text's fitted layout.
 * @returns The height, world units.
 */
function noteHeightOf(
  note: TextBoxObject & { readonly type: 'sticky' },
  layout: TextLayout,
): number {
  const isOverflowing = layout.height > noteBoxHeight(note.height) + 1e-6;
  const needed = isOverflowing
    ? noteHeightFor(note.width, layout.height, note.aspect)
    : noteMinHeight(note.width, note.aspect);
  return Math.max(note.height, needed);
}

/**
 * Writes an object's new text (a text object's or a sticky note's body, or a shape's label) as
 * one `setTextRuns`: a body with the box's measured size, so collaborators see the box grow as
 * it is typed and the edit is one undo step with its size; a label without one, since a
 * label has no size of its own. While the page has no font a body's size is left as it
 * is and the text is reported (`onWrittenUnmeasured`), never written with a size measured
 * without fonts.
 *
 * @param context - The mode's context: the document, origin, environment and layout, and where a
 *   refusal is reported.
 * @param id - The text object.
 * @param content - Its new content.
 * @returns Whether the document took it (it refuses content for a deleted or locked object; a
 *   locked one's refusal goes to `onCommandRefused`).
 */
export function writeTextContent(
  context: Pick<
    TextModeContext,
    'store' | 'origin' | 'environment' | 'layout' | 'onCommandRefused' | 'onWrittenUnmeasured'
  >,
  id: ObjectId,
  content: TextContent,
): boolean {
  const object = context.store.get(id);
  if (!isEditableTextObject(object)) return false;
  const isLabel = isLabelledObject(object);
  const layout = isLabel ? undefined : layoutContent(context, object, content);
  const size =
    layout === undefined || isLabelledObject(object) ? {} : { size: measuredSize(object, layout) };
  const paragraphs = listParagraphsOf(content);
  const input = {
    id,
    text: content.text,
    runs: [...content.runs],
    ...(paragraphs === undefined ? {} : { paragraphs: [...paragraphs] }),
    ...size,
  };
  const outcome = runCommand(
    context.store,
    context.origin,
    setTextRunsCommand,
    input,
    context.environment,
  );
  if (outcome.status !== 'applied') {
    context.onCommandRefused?.(outcome.errors);
    return false;
  }
  // No font to measure with: the stored size is left as it was, to be measured when they land.
  if (layout === undefined && !isLabel) context.onWrittenUnmeasured?.(id);
  return true;
}
