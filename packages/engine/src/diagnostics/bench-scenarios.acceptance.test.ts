import { describe, expect, it } from 'vitest';

import * as engine from '../index.js';

interface Camera {
  x: number;
  y: number;
  zoom: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  dpr: number;
}
interface Viewport {
  widthPx: number;
  heightPx: number;
  dpr: number;
}
interface Centre {
  x: number;
  y: number;
}
interface Sweep {
  start: Camera;
  legs: { camera: Camera; durationMs: number }[];
}
const { centredCamera, dragPath, lodWobbleLegs, typingTimeline, zoomSweepLegs } =
  engine as unknown as {
    centredCamera: (centre: Centre, zoom: number, viewport: Viewport) => Camera;
    zoomSweepLegs: (centre: Centre, viewport: Viewport, durationMs: number) => Sweep;
    lodWobbleLegs: (centre: Centre, viewport: Viewport, durationMs: number) => Sweep;
    dragPath: (options: {
      centre: { xPx: number; yPx: number };
      amplitudePx: { x: number; y: number };
      periodMs: number;
      durationMs: number;
      rateHz: number;
    }) => { atMs: number; xPx: number; yPx: number }[];
    typingTimeline: (rateHz: number, durationMs: number) => { atMs: number; data: string }[];
  };
const typedText = engine.TYPED_TEXT;

const viewport = { widthPx: 1_280, heightPx: 800, dpr: 2 };

describe('shared bench scenarios', () => {
  it('centres the camera and preserves the nightly zoom sweep', () => {
    expect(centredCamera({ x: 100, y: 50 }, 2, { ...viewport, dpr: 1 })).toEqual({
      x: -220,
      y: -150,
      zoom: 2,
      viewportWidthPx: 1_280,
      viewportHeightPx: 800,
      dpr: 1,
    });
    const sweep = zoomSweepLegs({ x: 0, y: 0 }, viewport, 8_000);
    expect(sweep.start.zoom).toBe(0.05);
    expect(sweep.legs.map(({ camera, durationMs }) => [camera.zoom, durationMs])).toEqual([
      [32, 4_000],
      [0.05, 4_000],
    ]);
  });

  it('preserves the nightly wobble and drag paths', () => {
    const wobble = lodWobbleLegs({ x: 0, y: 0 }, viewport, 8_000);
    expect(wobble.start.zoom).toBeCloseTo(0.19 / 2);
    expect(wobble.legs).toHaveLength(26);
    const path = dragPath({
      centre: { xPx: 640, yPx: 400 },
      amplitudePx: { x: 300, y: 100 },
      periodMs: 1_000,
      durationMs: 2_000,
      rateHz: 60,
    });
    expect(path).toHaveLength(121);
    expect(path[0]).toEqual({ atMs: 0, xPx: 640, yPx: 400 });
    expect(path.at(-1)?.atMs).toBe(2_000);
  });

  it('preserves the nightly typing timeline', () => {
    const keys = typingTimeline(20, 500);
    expect(keys.map(({ atMs }) => atMs)).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500]);
    expect(keys.map(({ data }) => data).join('')).toBe(typedText.slice(0, 10));
  });
});
