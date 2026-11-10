import type { ObjectId } from '@canvas/schema';

import type { ScenePassEnvironment } from '../../scene/scene-pass.js';

import { dropTextBounds } from './retained-text-target.js';
import type { TextObjectEntry } from './text-object-entry.js';
import type { TextPassKind } from './text-pass-definition.js';

/**
 * Forgets an object's entry when the object no longer draws text in a pass (a frame whose name
 * was hidden), withdrawing the drawing bounds it published, so nothing stale is culled
 * or ordered by it. Nothing happens for an object without an entry.
 *
 * @param entries - The pass's entries; the object's is removed.
 * @param id - The object.
 * @param kind - The pass kind, which says whether the object had drawing bounds.
 * @param setBounds - Publishes drawing bounds to the spatial index, when the host has one.
 */
export function dropTextEntry(
  entries: Map<ObjectId, TextObjectEntry>,
  id: ObjectId,
  kind: Pick<TextPassKind, 'hasDrawingBounds'>,
  setBounds: ScenePassEnvironment['setTextBounds'],
): void {
  const entry = entries.get(id);
  if (entry === undefined) return;
  dropTextBounds(id, entry.target.object, kind, setBounds);
  entries.delete(id);
}
