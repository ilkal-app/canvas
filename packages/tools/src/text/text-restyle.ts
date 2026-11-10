import { runCommand, setStyleCommand } from '@canvas/document';
import type { TextAlign, TextBaseDirection } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { applyStyle, commonStyle } from './runs/apply-style.js';
import { sliceRuns } from './runs/splice-runs.js';
import { isSameStyleField, shownTextStyle, TEXT_STYLE_FIELDS } from './runs/style-fields.js';
import type { TextStylePatch } from './runs/text-style-patch.js';
import {
  editedContentOf,
  isEditableTextObject,
  isLabelledObject,
  isTextBoxObject,
  type EditableTextObject,
} from './text-box-object.js';
import { layoutContent, measuredSize } from './text-content-writer.js';
import type { TextModeContext } from './text-mode-context.js';

/** A label has no runs of its own before it is written: nothing to style or read. */
const NO_RUNS = [] as const;

/**
 * The objects with text among some objects: text objects and sticky notes, and shapes
 * and connectors with a label, whose text the panel styles. Pure.
 *
 * @param objects - The objects.
 * @returns The objects with text.
 */
export function textObjectsOf(objects: readonly (BoardObject | undefined)[]): EditableTextObject[] {
  return objects.filter(
    (object): object is EditableTextObject =>
      isEditableTextObject(object) && (!isLabelledObject(object) || object.label !== null),
  );
}

/**
 * The style fields every character of every given text object shares, for the style panel when
 * text objects, sticky notes or labelled shapes are selected and not being edited (a missing
 * field is mixed). Pure.
 *
 * @param objects - The selected objects; only text objects, sticky notes and labelled shapes
 *   count.
 * @returns The shared fields; empty when there is no text object.
 */
export function commonStyleOfObjects(
  objects: readonly (BoardObject | undefined)[],
): TextStylePatch {
  const styles = textObjectsOf(objects).map((object) => {
    const { text, runs } = editedContentOf(object, NO_RUNS);
    return commonStyle(runs, 0, Math.max(1, text.length));
  });
  return sharedStyleOf(styles);
}

/**
 * The style fields some styles all share, with the same value (a missing field is mixed): what
 * `commonStyleOfObjects` gives over its objects' own styles, and over the shared styles of parts
 * of a selection (a large selection's style is worked out a part at a time). Pure.
 *
 * @param styles - The styles.
 * @returns The shared fields; empty when there are no styles.
 */
export function sharedStyleOf(styles: readonly TextStylePatch[]): TextStylePatch {
  const [first, ...others] = styles;
  if (first === undefined) return {};
  const shared = TEXT_STYLE_FIELDS.filter(
    (field) =>
      field in first &&
      others.every(
        (style) => field in style && isSameStyleField(field, first[field], style[field]),
      ),
  );
  return Object.fromEntries(shared.map((field) => [field, first[field]]));
}

/**
 * The style of every run of every given text object, for the style panel's per-axis values:
 * each run's shown style (`shownTextStyle`), in order. Pure.
 *
 * @param objects - The selected objects; only text objects, sticky notes and labelled shapes
 *   count.
 * @returns The runs' styles; empty when there is no text object.
 */
export function runStylesOfObjects(
  objects: readonly (BoardObject | undefined)[],
): TextStylePatch[] {
  return textObjectsOf(objects).flatMap((object): TextStylePatch[] => {
    const { text, runs } = editedContentOf(object, NO_RUNS);
    if (text.length === 0) return [commonStyle(runs, 0, 0)];
    return sliceRuns(runs, 0, text.length).map(({ style }) => shownTextStyle(style));
  });
}

/**
 * What the person is told when a restyle leaves locked text as it was.
 *
 * @param count - How many locked objects were left, at least 1.
 * @returns The sentence.
 */
export function lockedLeftNotice(count: number): string {
  return count === 1
    ? '1 locked object was left as it was.'
    : `${String(count)} locked objects were left as they were.`;
}

/**
 * The text objects a restyle would leave, laid out and measured but not written: for
 * the style panel's live preview of a drag, each unlocked text box with the patch on every run
 * and the size it measures to. Labels and locked text are left as they are. Pure apart from the
 * layout it measures with.
 *
 * @param context - The store and the layout.
 * @param ids - The selected objects' ids.
 * @param patch - The fields the drag would set.
 * @returns The restyled text boxes; empty for none.
 */
export function previewTextObjects(
  context: Pick<TextModeContext, 'store' | 'layout'>,
  ids: readonly ObjectId[],
  patch: TextStylePatch,
): readonly EditableTextObject[] {
  return textObjectsOf(ids.map((id) => context.store.get(id))).flatMap((object) => {
    if (object.locked || !isTextBoxObject(object)) return [];
    const runs = applyStyle(object.runs, 0, object.text.length, patch);
    const layout = layoutContent(context, object, {
      text: object.text,
      runs,
      paragraphs: object.paragraphs,
    });
    const size = layout === undefined ? {} : measuredSize(object, layout);
    return [{ ...object, runs, ...size }];
  });
}

/**
 * Restyles whole text objects, sticky notes and shape labels that are selected and not being
 * edited: every character takes the fields, and each text box's measured
 * size follows (a label has none), all in one
 * `setStyle` (one command, one transaction, one change set, one undo step), so collaborators
 * never see some texts restyled and others not. Locked texts are left out before writing and
 * the person is told (`onNotice`, {@link lockedLeftNotice}), so the restyle is never partial by
 * refusal. A text that cannot be laid out (no font yet) is restyled without a size and reported
 * (`onWrittenUnmeasured`).
 *
 * @param context - The mode's context: the document, origin, environment, layout, capture and
 *   where notices, refusals and unmeasured texts go.
 * @param ids - The selected objects; only text objects and sticky notes are restyled.
 * @param patch - The style fields.
 */
export function restyleTextObjects(
  context: Pick<
    TextModeContext,
    | 'store'
    | 'origin'
    | 'environment'
    | 'layout'
    | 'capture'
    | 'onNotice'
    | 'onCommandRefused'
    | 'onWrittenUnmeasured'
  >,
  ids: readonly ObjectId[],
  patch: TextStylePatch,
): void {
  const texts = textObjectsOf(ids.map((id) => context.store.get(id)));
  const unlocked = texts.filter((object) => !object.locked);
  if (unlocked.length < texts.length) {
    context.onNotice?.(lockedLeftNotice(texts.length - unlocked.length));
  }
  if (unlocked.length === 0 || Object.keys(patch).length === 0) return;
  const unmeasured: ObjectId[] = [];
  const changes = unlocked.map((object) => {
    const style = { textStyle: patch };
    if (!isTextBoxObject(object)) return { id: object.id, style };
    const runs = applyStyle(object.runs, 0, object.text.length, patch);
    const layout = layoutContent(context, object, {
      text: object.text,
      runs,
      paragraphs: object.paragraphs,
    });
    if (layout === undefined) unmeasured.push(object.id);
    const size = layout === undefined ? {} : { size: measuredSize(object, layout) };
    return { id: object.id, style, ...size };
  });
  context.capture.command(() => {
    const { store, origin, environment } = context;
    const outcome = runCommand(store, origin, setStyleCommand, { changes }, environment);
    if (outcome.status !== 'applied') {
      context.onCommandRefused?.(outcome.errors);
      return;
    }
    for (const id of unmeasured) context.onWrittenUnmeasured?.(id);
  });
}

/**
 * Aligns the lines of text objects and sticky notes (left, centre, right, or their paragraphs'
 * start or end), one `setStyle`, one undo step. Locked text boxes are left unchanged and
 * reported with the same notice as restyling.
 *
 * @param context - The mode's context.
 * @param ids - The objects; only text objects and sticky notes are aligned.
 * @param align - The alignment.
 */
export function alignTextObjects(
  context: Pick<TextModeContext, 'store' | 'origin' | 'environment' | 'capture' | 'onNotice'>,
  ids: readonly ObjectId[],
  align: TextAlign,
): void {
  setTextBoxField(context, ids, { align });
}

/**
 * Sets the base direction of text objects and sticky notes, one `setStyle`, one undo
 * step. Locked text boxes are left unchanged and reported with the same notice as restyling.
 *
 * @param context - The mode's context.
 * @param ids - The objects; only text objects and sticky notes take a direction.
 * @param direction - The direction; `auto` is written, not removed.
 */
export function directTextObjects(
  context: Pick<TextModeContext, 'store' | 'origin' | 'environment' | 'capture' | 'onNotice'>,
  ids: readonly ObjectId[],
  direction: TextBaseDirection,
): void {
  setTextBoxField(context, ids, { direction });
}

/**
 * Sets one field of every unlocked text object and sticky note among `ids`.
 *
 * @param context - The mode's context.
 * @param ids - The objects.
 * @param style - The field.
 */
function setTextBoxField(
  context: Pick<TextModeContext, 'store' | 'origin' | 'environment' | 'capture' | 'onNotice'>,
  ids: readonly ObjectId[],
  style: { readonly align: TextAlign } | { readonly direction: TextBaseDirection },
): void {
  const texts = ids.map((id) => context.store.get(id)).filter(isTextBoxObject);
  const unlocked = texts.filter((object) => !object.locked);
  if (unlocked.length < texts.length) {
    context.onNotice?.(lockedLeftNotice(texts.length - unlocked.length));
  }
  if (unlocked.length === 0) return;
  const changes = unlocked.map(({ id }) => ({ id, style }));
  context.capture.command(() => {
    runCommand(context.store, context.origin, setStyleCommand, { changes }, context.environment);
  });
}

/**
 * Whether a weight reads as bold: 600 and up, as CSS's `bold` threshold has it.
 *
 * @param weight - The weight.
 * @returns True for semibold and heavier.
 */
export function isBoldWeight(weight: number): boolean {
  return weight >= 600;
}

/**
 * The weight a bold toggle sets (the prototype's rule): regular when everything is bold (600 and
 * up), bold otherwise, mixed included.
 *
 * @param current - The shared fields of what the toggle acts on.
 * @returns The weight to set.
 */
export function toggledWeight(current: TextStylePatch): 400 | 700 {
  return current.weight !== undefined && isBoldWeight(current.weight) ? 400 : 700;
}

/**
 * The slant an italic toggle sets: upright when everything is italic, italic otherwise.
 *
 * @param current - The shared fields of what the toggle acts on.
 * @returns Whether to set italic.
 */
export function toggledItalic(current: TextStylePatch): boolean {
  return current.italic !== true;
}

/**
 * The underline a toggle sets (Cmd+U): off only when every selected character is
 * underlined, else on, as with italic.
 *
 * @param current - The selection's common style.
 * @returns The underline to set.
 */
export function toggledUnderline(current: TextStylePatch): boolean {
  return current.underline !== true;
}

/**
 * The strikethrough a toggle sets (Cmd+Shift+X): off only when every selected character
 * is struck through, else on.
 *
 * @param current - The selection's common style.
 * @returns The strikethrough to set.
 */
export function toggledStrikethrough(current: TextStylePatch): boolean {
  return current.strikethrough !== true;
}
