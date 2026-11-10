// Acceptance for tool panel placement above the floating dock.
import { describe, expect, it } from 'vitest';

import { TOOL_PANEL_GAP, TOOL_PANEL_INSET, toolPanelPlacement } from './tool-panel-placement.js';

describe('tool panel placement', () => {
  it('matches the owner-approved frame A', () => {
    expect(TOOL_PANEL_GAP).toBe(8);
    expect(TOOL_PANEL_INSET).toBe(16);
    expect(
      toolPanelPlacement(
        { x: 482, y: 834, width: 476, height: 50 },
        { width: 468, height: 44 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ x: 486, y: 782, width: 468, height: 44 });
  });

  it('clamps the panel to either viewport side', () => {
    const panel = { width: 200, height: 40 };
    const viewport = { width: 500, height: 300 };
    expect(toolPanelPlacement({ x: 0, y: 200, width: 50, height: 50 }, panel, viewport).x).toBe(16);
    expect(toolPanelPlacement({ x: 450, y: 200, width: 50, height: 50 }, panel, viewport).x).toBe(
      284,
    );
  });

  it('starts an oversized panel at the inset and rounds both coordinates', () => {
    expect(
      toolPanelPlacement(
        { x: 100.5, y: 200.5, width: 101, height: 50 },
        { width: 480, height: 40.25 },
        { width: 500, height: 300 },
      ),
    ).toEqual({ x: 16, y: 152, width: 480, height: 40.25 });
    expect(
      toolPanelPlacement(
        { x: 101.2, y: 200.5, width: 101, height: 50 },
        { width: 80, height: 40.25 },
        { width: 500, height: 300 },
      ),
    ).toEqual({ x: 112, y: 152, width: 80, height: 40.25 });
  });
});
