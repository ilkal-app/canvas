import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';

import { planCameraInput } from './camera-input-plan.js';
import { FIT_TRANSITION_MS } from './engine-glide.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const BOUNDS = {
  contentBounds: () => ({ minX: 1000, minY: 1000, maxX: 1400, maxY: 1300 }),
  selectionBounds: () => undefined,
};

describe('planCameraInput', () => {
  it('glides a fit unless the person prefers reduced motion', () => {
    const fit = { kind: 'keyZoom', command: 'zoomToFit' } as const;
    expect(planCameraInput(fit, CAMERA, BOUNDS, () => false)?.durationMs).toBe(FIT_TRANSITION_MS);
    expect(planCameraInput(fit, CAMERA, BOUNDS, () => true)?.durationMs).toBe(0);
  });

  it('jumps for a zoom step and plans nothing where nothing moves', () => {
    const plan = planCameraInput(
      { kind: 'keyZoom', command: 'zoomIn' },
      CAMERA,
      BOUNDS,
      () => false,
    );
    expect(plan?.durationMs).toBe(0);
    expect(plan?.next.zoom).toBeGreaterThan(1);
    const none = { contentBounds: () => undefined, selectionBounds: () => undefined };
    expect(
      planCameraInput({ kind: 'keyZoom', command: 'zoomToSelection' }, CAMERA, none, () => false),
    ).toBeUndefined();
  });
});
