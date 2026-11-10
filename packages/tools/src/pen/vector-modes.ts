import type { ObjectId } from '@canvas/schema';

import type { PenModeContext } from './pen-context.js';
import { PenMode, type PenModeStart } from './pen-mode.js';
import { VectorEditMode } from './vector-edit-mode.js';

// The two sub-tools of one vector editing session (the prototype's `makeEdit` and `makePen`): the
// pen (P) and the move tool (V) hand the same path to each other when the toolbar's tool changes,
// so each is built here with a factory for the other, and neither module imports the other.

/**
 * The pen tool's mode, whose V switches to vector editing's move sub-tool on the same path.
 *
 * @param context - The document, the pen style and the callbacks.
 * @param start - A new path, or the path to act on.
 * @returns The mode.
 */
export function createPenMode(context: PenModeContext, start: PenModeStart): PenMode {
  return new PenMode(context, start, (id) => createVectorEditMode(context, id));
}

/**
 * Vector editing of a path (its move sub-tool), whose P switches to the pen on the same path.
 *
 * @param context - The document and the callbacks.
 * @param id - The path.
 * @returns The mode.
 */
export function createVectorEditMode(context: PenModeContext, id: ObjectId): VectorEditMode {
  return new VectorEditMode(context, id, (pathId) =>
    createPenMode(context, { kind: 'edit', id: pathId }),
  );
}
