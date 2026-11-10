// CONTRACT: wheel direction changes zoom around the pointed board position;
// only collaborators sharing a viewport on the shown page contribute coloured view boxes.
import { describe, expect, it } from 'vitest';

import { colorForPrincipal, type PresenceSnapshot, type PresenceState } from '@canvas/collab';

import { peerViewsOf, wheelZoomAt } from './minimap-layout.js';

describe('minimap interaction acceptance', () => {
  it('zooms out on wheel down and in on wheel up about the pointed board point', () => {
    const camera = {
      x: -40,
      y: 75,
      zoom: 0.37,
      viewportWidthPx: 900,
      viewportHeightPx: 600,
      dpr: 1,
    };
    const target = { x: 160, y: 275 };
    const down = wheelZoomAt(camera, target, 120);
    const up = wheelZoomAt(camera, target, -120);
    expect(down.centerXPx).toBeCloseTo(74);
    expect(down.centerYPx).toBeCloseTo(74);
    expect(up.centerXPx).toBeCloseTo(74);
    expect(up.centerYPx).toBeCloseTo(74);
    expect(down.scale).toBeLessThan(1);
    expect(up.scale).toBeGreaterThan(1);
    expect(down.scale * up.scale).toBeCloseTo(1);
  });

  it('skips another page and absent viewports, retaining the matching peer colour', () => {
    // Each peer's colour is their colourway's dark, from their id; the colour sent is ignored.
    const state = (id: string, page: string, hasViewport: boolean): PresenceState =>
      ({
        principal: { id, kind: 'user', name: id, color: '#123456' },
        page,
        ...(hasViewport ? { viewport: { x: 3, y: 4, w: 50, h: 60, zoom: 2 } } : {}),
      }) as PresenceState;
    const snapshot: PresenceSnapshot = new Map([
      [1, state('jonas', 'other', true)],
      [2, state('ada', 'shown', false)],
      [3, state('kai', 'shown', true)],
    ]);
    expect(peerViewsOf(snapshot, 'shown', 'first')).toEqual([
      { x: 3, y: 4, width: 50, height: 60, color: colorForPrincipal('kai') },
    ]);
  });
});
