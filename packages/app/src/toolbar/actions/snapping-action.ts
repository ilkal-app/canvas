import type { ToolbarAction } from '../toolbar-actions.js';

/**
 * The toolbar's snapping toggle: turns the select tool's snapping on or off, the same
 * `toggleSnapping` action as mod+shift+', pressed while snapping is on.
 */
export const toolbarAction: ToolbarAction = {
  id: 'toggle-snapping',
  label: 'Snapping',
  order: 20,
  action: { type: 'navigate', command: 'toggleSnapping' },
  isPressed: (state) => state.isSnappingOn,
};
