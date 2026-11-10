// Where a tool panel goes: centred on the dock, 8 px above it, 16 px from the sides.
import { describe, expect, it } from 'vitest';

import { TOOL_PANEL_GAP, TOOL_PANEL_INSET, toolPanelPlacement } from './tool-panel-placement.js';

// The design's frame A: a 1440×900 viewport, the dock at 482,834 (476×50), the sticky panel
// 468×44 at 486,782.
const VIEWPORT = { width: 1440, height: 900 };
const DOCK = { x: 482, y: 834, width: 476, height: 50 };

describe('toolPanelPlacement', () => {
  it('matches frame A: centred on the dock and 8 px above it', () => {
    expect(toolPanelPlacement(DOCK, { width: 468, height: 44 }, VIEWPORT)).toEqual({
      x: 486,
      y: 782,
      width: 468,
      height: 44,
    });
    expect(TOOL_PANEL_GAP).toBe(8);
    expect(TOOL_PANEL_INSET).toBe(16);
  });

  it('rounds to whole pixels', () => {
    const placed = toolPanelPlacement(DOCK, { width: 467, height: 44 }, VIEWPORT);
    expect(placed.x).toBe(Math.round(720 - 467 / 2));
  });

  it('moves sideways to keep 16 px from either side', () => {
    const narrow = { width: 500, height: 800 };
    const dock = { x: 12, y: 734, width: 476, height: 50 };
    expect(toolPanelPlacement(dock, { width: 468, height: 44 }, narrow).x).toBe(16);
    const right = { x: 300, y: 734, width: 200, height: 50 };
    expect(toolPanelPlacement(right, { width: 300, height: 44 }, narrow).x).toBe(500 - 16 - 300);
  });

  it('starts a panel wider than the room at the inset', () => {
    const tiny = { width: 320, height: 640 };
    const dock = { x: 0, y: 574, width: 320, height: 50 };
    expect(toolPanelPlacement(dock, { width: 400, height: 44 }, tiny).x).toBe(16);
  });
});
