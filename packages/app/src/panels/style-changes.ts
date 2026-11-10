import { STYLE_FIELDS_BY_TYPE, type StyleFieldName, type StylePatch } from '@canvas/document';
import type { BoardObject } from '@canvas/schema';

import type { StyleChange } from '../state/shell-action.js';

/**
 * Whether an object has text that `textStyle` can restyle: a text or sticky, or a shape or
 * connector with a label.
 *
 * @param object - The object.
 * @returns True when it has text.
 */
function hasStyledText(object: BoardObject): boolean {
  if (object.type === 'shape' || object.type === 'connector') return object.label !== null;
  return object.type === 'text' || object.type === 'sticky';
}

/**
 * Whether an object's type takes every field of a style patch, as `setStyle` checks (it refuses
 * the whole command otherwise).
 *
 * @param object - The object.
 * @param style - The patch.
 * @returns True when `setStyle` would accept the patch for the object.
 */
export function takesStyle(object: BoardObject, style: StylePatch): boolean {
  const allowed: readonly StyleFieldName[] = STYLE_FIELDS_BY_TYPE[object.type];
  const fields = Object.keys(style) as StyleFieldName[];
  if (!fields.every((field) => allowed.includes(field))) return false;
  return style.textStyle === undefined || hasStyledText(object);
}

/**
 * The fields to set: one patch for every object, or a patch per object (a stroke colour that
 * keeps each object's own width). Called with undefined for a creation tool's style.
 */
export type StyleToApply = StylePatch | ((object: BoardObject | undefined) => StylePatch);

/**
 * The patch to set on one object, or on a creation tool's style (`object` undefined).
 *
 * @param style - The patch, or the function making it.
 * @param object - The object, if any.
 * @returns The patch.
 */
export function patchFor(style: StyleToApply, object: BoardObject | undefined): StylePatch {
  return typeof style === 'function' ? style(object) : style;
}

/**
 * The `setStyle` entries that set a patch on a selection: one per object that takes it, so a
 * field chosen for a mixed selection skips the objects it does not apply to instead of making
 * the command refuse them all.
 *
 * @param selection - The selected objects.
 * @param style - The fields to set, the same for all or per object.
 * @returns The changes, in selection order: none for an object whose patch is empty (nothing of
 *   that field to change) or that its type does not take.
 */
export function styleChangesFor(
  selection: readonly BoardObject[],
  style: StyleToApply,
): StyleChange[] {
  return selection.flatMap((object) => {
    const patch = patchFor(style, object);
    const isEmpty = Object.keys(patch).length === 0;
    return !isEmpty && takesStyle(object, patch) ? [{ id: object.id, style: patch }] : [];
  });
}
