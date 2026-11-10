import type { BoardObject } from '@canvas/schema';
import {
  commonStyleOfObjects,
  isTextBoxObject,
  runStylesOfObjects,
  sharedStyleOf,
  textObjectsOf,
  type TextStylePatch,
} from '@canvas/tools';

import { axisValuesOf, directionContextOf } from './text-style-context.js';
import type { TextStyleContext } from './text-style-types.js';

// What the style panel shows for selected text that is not being edited: worked out
// at once, or for a large selection a part at a time, so a paste or duplicate of thousands of
// objects, selected when it ends, never holds the page for the whole selection's styles.

/** A selection of more objects than this has its style worked out in stages. */
export const STAGED_STYLE_OBJECTS = 500;

/**
 * The style context of selected objects not being edited: their texts' shared style, alignment
 * and base direction; `undefined` when none of them has text.
 *
 * @param objects - The selected objects, as stored.
 * @returns The context.
 */
export function selectionStyleContext(
  objects: readonly (BoardObject | undefined)[],
): TextStyleContext | undefined {
  if (!hasText(objects)) return undefined;
  return contextOf(objects, commonStyleOfObjects(objects), runStylesOfObjects(objects));
}

/**
 * {@link selectionStyleContext} in stages: the texts' styles a part at a time, `stage` awaited
 * between, then shared across the parts. The same context.
 *
 * @param objects - The selected objects, as stored.
 * @param stage - Awaited between two parts; what it rejects with is passed on.
 * @returns The context.
 */
export async function selectionStyleContextInStages(
  objects: readonly (BoardObject | undefined)[],
  stage: () => Promise<void>,
): Promise<TextStyleContext | undefined> {
  if (!hasText(objects)) return undefined;
  const texts = textObjectsOf(objects);
  const parts: TextStylePatch[] = [];
  const runStyles: TextStylePatch[] = [];
  for (let start = 0; start < texts.length; start += STAGED_STYLE_OBJECTS) {
    await stage();
    const part = texts.slice(start, start + STAGED_STYLE_OBJECTS);
    parts.push(commonStyleOfObjects(part));
    runStyles.push(...runStylesOfObjects(part));
  }
  await stage();
  return contextOf(objects, sharedStyleOf(parts), runStyles);
}

/**
 * Whether any selected object has text the panel styles: a text box, or a labelled shape or
 * connector.
 *
 * @param objects - The selected objects.
 * @returns Whether one has.
 */
function hasText(objects: readonly (BoardObject | undefined)[]): boolean {
  return objects.some(
    (object) =>
      isTextBoxObject(object) ||
      ((object?.type === 'shape' || object?.type === 'connector') && object.label !== null),
  );
}

/**
 * The context from the selection's shared style and its runs' styles.
 *
 * @param objects - The selected objects.
 * @param style - Their texts' shared style.
 * @param runStyles - Every run's style, for the per-axis values.
 * @returns The context.
 */
function contextOf(
  objects: readonly (BoardObject | undefined)[],
  style: TextStylePatch,
  runStyles: readonly TextStylePatch[],
): TextStyleContext {
  const axisValues = axisValuesOf(runStyles);
  const axes = axisValues === undefined ? {} : { axisValues };
  const texts = objects.filter(isTextBoxObject);
  if (texts.length === 0) {
    const fixed = { align: undefined, canAlign: false, canDirect: false } as const;
    return { style, ...fixed, isEditing: false, ...axes };
  }
  const aligns = new Set(texts.map((object) => object.align));
  const [align] = aligns;
  const direction = directionContextOf(texts);
  const shared = aligns.size === 1 ? align : undefined;
  return { style, align: shared, ...direction, isEditing: false, ...axes };
}
