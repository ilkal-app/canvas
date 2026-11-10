import { describe, expect, it } from 'vitest';

import { computeFollowViewport, followClient } from './follow-viewport.js';
import type { PresenceSnapshot, PresenceState } from './presence-state.js';

const target = { x: 100, y: 200, w: 800, h: 600, zoom: 2 };

describe('computeFollowViewport', () => {
  it('shows exactly the followed region on a screen of the same size', () => {
    expect(computeFollowViewport(target, { widthPx: 1600, heightPx: 1200 })).toEqual(target);
  });

  it('fits the followed region inside a smaller screen, centred on the same point', () => {
    const viewport = computeFollowViewport(target, { widthPx: 400, heightPx: 400 });

    expect(viewport.zoom).toBe(0.5);
    expect(viewport.w).toBe(800);
    expect(viewport.h).toBe(800);
    expect(viewport.x + viewport.w / 2).toBe(500);
    expect(viewport.y + viewport.h / 2).toBe(500);
  });

  it('keeps the whole followed region visible on a screen with a different aspect ratio', () => {
    const viewport = computeFollowViewport(target, { widthPx: 1920, heightPx: 600 });

    expect(viewport.w).toBeGreaterThanOrEqual(target.w);
    expect(viewport.h).toBeCloseTo(target.h, 9);
    expect(viewport.x).toBeLessThanOrEqual(target.x);
  });

  it('rejects an empty screen and a malformed target', () => {
    expect(() => computeFollowViewport(target, { widthPx: 0, heightPx: 600 })).toThrow(RangeError);
    expect(() => computeFollowViewport({ ...target, w: 0 }, { widthPx: 1, heightPx: 1 })).toThrow(
      RangeError,
    );
  });
});

describe('followClient', () => {
  const principal = { id: 'user-2', kind: 'user', name: 'Grace', color: '#ff7f0e' } as const;
  const withViewport: PresenceState = { principal, viewport: target, updatedAt: 0 };
  const withoutViewport: PresenceState = { principal, updatedAt: 0 };
  const snapshot: PresenceSnapshot = new Map([
    [7, withViewport],
    [8, withoutViewport],
  ]);
  const screen = { widthPx: 1600, heightPx: 1200 };

  it('returns the viewport that follows the client', () => {
    expect(followClient(snapshot, 7, screen)).toEqual(target);
  });

  it('returns undefined for a client that is gone or shares no viewport', () => {
    expect(followClient(snapshot, 9, screen)).toBeUndefined();
    expect(followClient(snapshot, 8, screen)).toBeUndefined();
  });
});
