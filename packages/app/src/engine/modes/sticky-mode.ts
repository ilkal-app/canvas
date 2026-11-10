import type { ObjectId } from '@canvas/schema';
import { StickyMode, type StickyModeContext } from '@canvas/tools';

import { stickyToolStyleOf } from '../../tool-styles/sticky-style.js';

import type { ToolModeEntry, ToolModeServices } from './tool-mode-entry.js';

/**
 * The sticky mode's context: the services, with new notes and their text in the sticky tool's
 * style (`stickyToolStyleOf`: its colour, the last picked; its text style; centred), and the one
 * selected sticky note, which a Shift+click stacks below when the services' `stickyAt` finds no
 * note under it.
 *
 * @param services - What the modes work on.
 * @returns The context.
 */
export function stickyContextOf(services: ToolModeServices): StickyModeContext {
  const style = () => stickyToolStyleOf(services.toolStyleOf?.('sticky'));
  return {
    ...services,
    newTextStyle: () => style().textStyle,
    newTextAlign: () => style().align,
    newNoteColor: () => style().color,
    newNoteAspect: () => style().aspect,
    selectedSticky: () => {
      const [id, ...more] = services.selectTool.selection.ids;
      return more.length === 0 ? stickyOf(services, id) : undefined;
    },
  };
}

/**
 * An id when it names a sticky note, for Shift+click stacking.
 *
 * @param services - What the modes work on.
 * @param id - The object, if any.
 * @returns The id, or undefined when it is not a sticky note.
 */
function stickyOf(services: ToolModeServices, id: ObjectId | undefined): ObjectId | undefined {
  return id !== undefined && services.store.get(id)?.type === 'sticky' ? id : undefined;
}

/**
 * The sticky tool (`s`): a click creates a 200 × 200 note centred on it in the tool's
 * colour and edits its text; a double-click or Enter on a sticky note edits its text (at the
 * double-clicked point), unless it is locked.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'sticky',
  activates: ['sticky'],
  create: (services) => new StickyMode(stickyContextOf(services), { kind: 'create' }),
  activate: (services, activation, object) => {
    if (object.locked) return undefined;
    const world = activation.source === 'enter' ? {} : { world: activation.world };
    return new StickyMode(stickyContextOf(services), { kind: 'edit', id: object.id, ...world });
  },
};
