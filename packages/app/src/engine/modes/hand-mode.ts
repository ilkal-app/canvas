import { HandMode } from '@canvas/tools';

import type { ToolModeEntry } from './tool-mode-entry.js';

/**
 * The hand tool (`h`): a primary-button drag pans the view through the mount's camera
 * (`ToolModeServices.panView`), as a middle-button drag or a drag with Space held does from any
 * tool. Without a view to pan (a document side with no camera), the drag does nothing.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'hand',
  activates: [],
  create: (services) =>
    new HandMode({
      pan: (deltaXPx, deltaYPx) => {
        services.panView?.(deltaXPx, deltaYPx);
      },
    }),
};
