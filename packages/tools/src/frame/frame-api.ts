// The frame area's public API, re-exported whole by the package's index: the frame
// tool's mode, where a drawn frame goes and what it takes in, its default name, and editing a
// frame's name in place.
export {
  clickedFrameBox,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  FrameMode,
  NEW_FRAME_BACKGROUND,
} from './frame-mode.js';
export type { FrameModeContext } from './frame-mode.js';
export { FRAME_NAME_PREFIX, nextFrameName } from './frame-name.js';
export { planFramePlacement } from './frame-placement.js';
export {
  frameUnderPoint,
  withCreationParent,
  withCreationParentGroups,
} from './creation-parent.js';
export type { CreationBatch, CreationObject } from './creation-parent.js';
export type { FramePlacement, FramePlacementSource } from './frame-placement.js';
export { FrameNameMode, MAX_FRAME_NAME_LENGTH } from '../select/frame-name-mode.js';
export type { FrameNameModeContext } from '../select/frame-name-mode.js';
