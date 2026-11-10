import type {
  BoardObject,
  ConnectorObject,
  ShapeObject,
  ParagraphStyle,
  StickyObject,
  StyleRun,
  TextObject,
} from '@canvas/schema';

import { listParagraphsOf, withoutParagraphs } from './paragraph-edits.js';

/**
 * An object whose text is a body the editor edits in its own box: a text object or a sticky
 * note. Its stored size follows its text.
 */
export type TextBoxObject = TextObject | StickyObject;

/** An object whose text is a label with no size of its own: a shape's or a connector's. */
export type LabelledObject = ShapeObject | ConnectorObject;

/**
 * An object whose text the editor can edit: a text box's body, or a label (`LabelledObject`): a
 * shape's, laid out inside the shape (`shapeLabelPlacement`), or a connector's,
 * centred halfway along its route (`connectorLabelPlacement`).
 */
export type EditableTextObject = TextBoxObject | LabelledObject;

/**
 * Tells whether an editable object's text is a label (a shape's or a connector's) rather than a
 * body. Pure.
 *
 * @param object - The object.
 * @returns True for a shape or a connector.
 */
export function isLabelledObject(object: EditableTextObject): object is LabelledObject {
  return object.type === 'shape' || object.type === 'connector';
}

/**
 * Tells whether an object is a {@link TextBoxObject}, whose body the editor can edit. Pure.
 *
 * @param object - The object, or nothing.
 * @returns True for a text object or a sticky note.
 */
export function isTextBoxObject(object: BoardObject | undefined): object is TextBoxObject {
  return object?.type === 'text' || object?.type === 'sticky';
}

/**
 * Tells whether an object is an {@link EditableTextObject}: a text box, or a shape or connector
 * whose label the editor can edit. Pure.
 *
 * @param object - The object, or nothing.
 * @returns True for a text object, a sticky note, a shape or a connector.
 */
export function isEditableTextObject(
  object: BoardObject | undefined,
): object is EditableTextObject {
  return isTextBoxObject(object) || object?.type === 'shape' || object?.type === 'connector';
}

/** The characters and runs the editor edits in an object. */
export interface EditedContent {
  /** The characters. */
  readonly text: string;
  /** Their runs. */
  readonly runs: readonly StyleRun[];
  /** One style per paragraph; all plain when absent. */
  readonly paragraphs?: readonly ParagraphStyle[] | undefined;
}

/**
 * The text an object's editor edits: a text box's body, a shape's or connector's label, or, for
 * one without a label, empty text whose one zero-length run carries the style typing will use. Pure.
 *
 * @param object - The object.
 * @param emptyRuns - The runs of a label not written yet (one zero-length run).
 * @returns The characters and runs.
 */
export function editedContentOf(
  object: EditableTextObject,
  emptyRuns: readonly StyleRun[],
): EditedContent {
  if (!isLabelledObject(object)) return object;
  return object.label ?? { text: '', runs: emptyRuns };
}

/**
 * An object with other text in place of its own: a text box's body, or a shape's label. Pure: a
 * new object; the input is not changed.
 *
 * @param object - The object.
 * @param content - The characters and runs.
 * @returns The object with that text, for a preview.
 */
export function withEditedContent(
  object: EditableTextObject,
  content: EditedContent,
): EditableTextObject {
  const paragraphs = listParagraphsOf(content);
  const text = {
    text: content.text,
    runs: [...content.runs],
    ...(paragraphs === undefined ? {} : { paragraphs: [...paragraphs] }),
  };
  if (isLabelledObject(object)) return { ...object, label: text };
  // Paragraph styles follow the content: none kept from the object's old text.
  return { ...withoutParagraphs(object), ...text };
}
