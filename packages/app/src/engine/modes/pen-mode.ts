import { createPenMode, createVectorEditMode, type PenModeContext } from '@canvas/tools';

import { penToolStyleOf } from '../../tool-styles/pen-style.js';

import type { ToolModeEntry, ToolModeServices } from './tool-mode-entry.js';

/**
 * The pen's context: the tool modes' services, new paths painted in the pen tool's style
 * (`toolStyleOf('pen')`, its defaults with the person's choices over them).
 *
 * @param services - The tool modes' services.
 * @returns The context.
 */
export function penContextOf(services: ToolModeServices): PenModeContext {
  return { ...services, newPathStyle: () => penToolStyleOf(services.toolStyleOf?.('pen')) };
}

/**
 * The pen tool (`p`): presses place corner and smooth points of a new path, connect, close,
 * branch and insert; a double-click or Enter on a path enters vector editing (its move sub-tool,
 * which the toolbar shows as the select tool; P and V switch between the two on the same path),
 * unless the path is locked.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'pen',
  activates: ['path'],
  create: (services) => createPenMode(penContextOf(services), { kind: 'create' }),
  activate: (services, activation, object) =>
    object.locked ? undefined : createVectorEditMode(penContextOf(services), object.id),
};
