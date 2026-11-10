// The tool panel framework's state: one panel at a time, the chosen tool's, and
// whether the tool stays after placing.
import { describe, expect, it } from 'vitest';

import { FLOATING_DOCK_TOOL_IDS, FLOATING_DOCK_TOOLS } from './floating-dock.js';
import {
  INITIAL_TOOL_PANEL_STATE,
  isToolPanelId,
  keepsToolAfterPlacing,
  TOOL_PANEL_IDS,
  toolPanelReducer,
  type ToolPanelState,
} from './tool-panel-state.js';

describe('the panel registry', () => {
  it('lists the six tools with a panel, in dock order', () => {
    expect(TOOL_PANEL_IDS).toEqual(['shapes', 'image', 'connector', 'draw', 'sticky', 'reactions']);
    for (const id of FLOATING_DOCK_TOOL_IDS) {
      expect(isToolPanelId(id)).toBe(FLOATING_DOCK_TOOLS[id].hasPanel);
    }
  });
});

describe('toolPanelReducer', () => {
  it('starts on select with no panel', () => {
    expect(INITIAL_TOOL_PANEL_STATE).toEqual({ tool: 'select', openPanel: null });
  });

  it('opens a tool’s panel when it is chosen and swaps it for another', () => {
    const shapes = toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'choose', tool: 'shapes' });
    expect(shapes).toEqual({ tool: 'shapes', openPanel: 'shapes' });
    expect(toolPanelReducer(shapes, { type: 'choose', tool: 'sticky' })).toEqual({
      tool: 'sticky',
      openPanel: 'sticky',
    });
  });

  it('closes the panel for a tool without one', () => {
    const shapes: ToolPanelState = { tool: 'shapes', openPanel: 'shapes' };
    for (const tool of ['select', 'pan', 'section', 'text', 'comment'] as const) {
      expect(toolPanelReducer(shapes, { type: 'choose', tool })).toEqual({ tool, openPanel: null });
    }
  });

  it('toggles the panel when its tool is chosen again, keeping the tool', () => {
    const open: ToolPanelState = { tool: 'image', openPanel: 'image' };
    const closed = toolPanelReducer(open, { type: 'choose', tool: 'image' });
    expect(closed).toEqual({ tool: 'image', openPanel: null });
    expect(toolPanelReducer(closed, { type: 'choose', tool: 'image' })).toEqual(open);
  });

  it('closes the panel on Escape and keeps the tool; returns the same state with none', () => {
    const open: ToolPanelState = { tool: 'connector', openPanel: 'connector' };
    expect(toolPanelReducer(open, { type: 'escape' })).toEqual({
      tool: 'connector',
      openPanel: null,
    });
    expect(toolPanelReducer(INITIAL_TOOL_PANEL_STATE, { type: 'escape' })).toBe(
      INITIAL_TOOL_PANEL_STATE,
    );
  });

  it('closes the panel when the tool changes from outside the dock', () => {
    const open: ToolPanelState = { tool: 'sticky', openPanel: 'sticky' };
    expect(toolPanelReducer(open, { type: 'toolChanged', tool: 'sticky' })).toBe(open);
    expect(toolPanelReducer(open, { type: 'toolChanged', tool: 'select' })).toEqual({
      tool: 'select',
      openPanel: null,
    });
  });

  it('returns the same state when a panel-less tool is chosen again', () => {
    const text: ToolPanelState = { tool: 'text', openPanel: null };
    expect(toolPanelReducer(text, { type: 'choose', tool: 'text' })).toBe(text);
  });
});

describe('keepsToolAfterPlacing', () => {
  it('keeps the tool only while its panel shows', () => {
    expect(keepsToolAfterPlacing({ tool: 'sticky', openPanel: 'sticky' })).toBe(true);
    expect(keepsToolAfterPlacing({ tool: 'sticky', openPanel: null })).toBe(false);
    expect(keepsToolAfterPlacing(INITIAL_TOOL_PANEL_STATE)).toBe(false);
  });
});
