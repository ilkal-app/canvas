import { ConnectorLabelMode, ConnectorMode } from '@canvas/tools';

import { connectorToolStyleOf } from '../../tool-styles/connector-style.js';

import { lineToolContextOf } from './line-mode.js';
import type { ToolModeEntry } from './tool-mode-entry.js';

/**
 * The connector tool (`c`): a drag draws a connector in the tool's style, each end
 * attached to an object's anchor, to the object under the pointer (`connectorTargetAt`), or left a
 * free point, as one `connect` command and one undo step. A double-click or Enter on a connector
 * edits its label (at the double-clicked point), as a shape's is, unless it is locked; its ends are
 * dragged in the select tool (`select-mode.ts`).
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'connector',
  activates: ['connector'],
  activate: (services, activation, object) => {
    if (object.locked) return undefined;
    const world = activation.source === 'enter' ? {} : { world: activation.world };
    const mode = new ConnectorLabelMode(services, { id: object.id, ...world });
    return mode.session === undefined ? undefined : mode;
  },
  create: (services) =>
    new ConnectorMode({
      ...lineToolContextOf(services),
      source: services.selectTool.source,
      connectorStyle: () => connectorToolStyleOf(services.toolStyleOf?.('connector')),
      objectAt: (world, zoom) => services.connectorTargetAt?.(world, zoom),
      selectObjects: services.selectObjects,
      requestExit: services.requestExit,
    }),
};
