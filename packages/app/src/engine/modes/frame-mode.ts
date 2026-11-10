import { isFrameNameShown } from '@canvas/schema';
import { FrameMode, FrameNameMode, isAboveFrameTop, type FrameModeContext } from '@canvas/tools';

import type { ToolModeEntry, ToolModeServices } from './tool-mode-entry.js';

/**
 * The frame mode's context: the services, with the select tool's index and document, where a
 * drawn frame finds its parent and the objects it takes in, and where its corner snaps.
 *
 * @param services - What the modes work on.
 * @returns The context.
 */
export function frameContextOf(services: ToolModeServices): FrameModeContext {
  const { snapIndex } = services;
  return {
    ...services,
    newFrameNamePrefix: () => services.toolStyleOf?.('frame').framePrefix,
    ...(snapIndex === undefined
      ? {}
      : { board: { index: snapIndex, source: services.selectTool.source } }),
  };
}

/**
 * The frame tool (`f`): a drag draws a frame that takes in what is wholly inside it, a
 * click a 400 × 300 one; a double-click on a frame's title band edits its name in place (not on its
 * body, and not Enter, which leave the frame to the select tool), locked or not, since a name is
 * not position, size or rotation. A frame whose name is hidden (`isFrameNameShown`) has no
 * band to edit it in until its name is shown.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'frame',
  activates: ['frame'],
  create: (services) => new FrameMode(frameContextOf(services)),
  activate: (services, activation, object) => {
    if (object.type !== 'frame' || activation.source === 'enter') return undefined;
    const { source } = services.selectTool;
    const isOnTitle =
      isFrameNameShown(object, (id) => source.get(id)) &&
      isAboveFrameTop(object, source, activation.world);
    return isOnTitle ? new FrameNameMode(services, object.id) : undefined;
  },
};
