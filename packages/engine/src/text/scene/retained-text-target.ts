import type { BoardObject, ObjectId } from '@canvas/schema';

import type { SceneObject, ScenePassEnvironment } from '../../scene/scene-pass.js';

import type { TextObjectEntry } from './text-object-entry.js';
import type { TextPassKind } from './text-pass-definition.js';

/**
 * Refreshes a geometry-preserving move without consuming pending resource invalidations.
 * Existing layout/glyph refresh work will therefore rewrite against the current placement.
 *
 * @param entries - The text pass's retained state.
 * @param target - The latest exact object transform.
 * @param setBounds - Publishes the moved text's drawing bounds for culling and segments.
 * @param kind - The pass's kind: which objects publish bounds, and how they are found.
 * @param scale - The pass's scale now.
 */
export function retainTextTarget(
  entries: ReadonlyMap<ObjectId, TextObjectEntry>,
  target: SceneObject,
  setBounds: ScenePassEnvironment['setTextBounds'],
  kind: Pick<TextPassKind, 'hasDrawingBounds' | 'drawingBoundsOf'>,
  scale: number,
): void {
  const entry = entries.get(target.object.id);
  if (!entry) return;
  entry.target = target;
  if (kind.hasDrawingBounds(target.object)) {
    setBounds?.(target.object.id, kind.drawingBoundsOf(entry, scale));
  }
}

/**
 * Withdraws an object's drawing bounds from the spatial index, if its pass publishes any.
 *
 * @param id - The object.
 * @param object - The object as the pass last drew it.
 * @param kind - The pass's kind.
 * @param setBounds - Where bounds go.
 */
export function dropTextBounds(
  id: ObjectId,
  object: BoardObject,
  kind: Pick<TextPassKind, 'hasDrawingBounds'>,
  setBounds: ScenePassEnvironment['setTextBounds'],
): void {
  if (kind.hasDrawingBounds(object)) setBounds?.(id, undefined);
}

/**
 * Publishes every entry's drawing bounds again at a new scale (a kind whose bounds depend on it,
 * the frame title pass's on the device pixel ratio).
 *
 * @param entries - The pass's entries.
 * @param kind - The pass's kind.
 * @param scale - The scale now.
 * @param setBounds - Where bounds go.
 */
export function publishTextBounds(
  entries: ReadonlyMap<ObjectId, TextObjectEntry>,
  kind: Pick<TextPassKind, 'hasDrawingBounds' | 'drawingBoundsOf'>,
  scale: number,
  setBounds: ScenePassEnvironment['setTextBounds'],
): void {
  for (const [id, entry] of entries) {
    if (kind.hasDrawingBounds(entry.target.object)) {
      setBounds?.(id, kind.drawingBoundsOf(entry, scale));
    }
  }
}
