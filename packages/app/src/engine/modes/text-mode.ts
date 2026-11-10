import { TextMode } from '@canvas/tools';

import type { ToolModeEntry } from './tool-mode-entry.js';

/**
 * The text tool (`t`): a click creates an auto-width text box, a drag a fixed-width one, a
 * click on text edits it; a double-click or Enter on a text object edits it (at the double-clicked
 * point), unless it is locked.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'text',
  activates: ['text'],
  create: (services) => new TextMode(services, { kind: 'create' }),
  activate: (services, activation, object) => {
    if (object.locked) return undefined;
    const world = activation.source === 'enter' ? {} : { world: activation.world };
    return new TextMode(services, { kind: 'edit', id: object.id, ...world });
  },
};
