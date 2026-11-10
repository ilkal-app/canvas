import type { ToolbarAction } from '../toolbar-actions.js';

/**
 * The toolbar's grid toggle: shows or hides the dot grid, the same `toggleGrid` action as
 * mod+', pressed while the grid shows.
 */
export const toolbarAction: ToolbarAction = {
  id: 'toggle-grid',
  label: 'Grid',
  order: 10,
  action: { type: 'navigate', command: 'toggleGrid' },
  isPressed: (state) => state.isGridVisible,
};
