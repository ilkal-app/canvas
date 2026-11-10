// CONTRACT: every view and world-bounded object fits one undistorted map;
// mapping is reversible and a map target pans to the view's centre at unchanged zoom.
import { describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';

import {
  minimapFrame,
  minimapItems,
  panToCentre,
  toMap,
  toWorld,
  viewOf,
} from './minimap-layout.js';

const CAMERA: Camera = {
  x: -250,
  y: 90,
  zoom: 2.5,
  viewportWidthPx: 1000,
  viewportHeightPx: 500,
  dpr: 2,
};

function expectInside(rect: { x: number; y: number; width: number; height: number }): void {
  expect(rect.x).toBeGreaterThanOrEqual(-0.000001);
  expect(rect.y).toBeGreaterThanOrEqual(-0.000001);
  expect(rect.x + rect.width).toBeLessThanOrEqual(216.000001);
  expect(rect.y + rect.height).toBeLessThanOrEqual(120.000001);
}

describe('minimap layout acceptance', () => {
  it('fits an empty board around the whole view on both axes', () => {
    const view = viewOf(CAMERA);
    expectInside(toMap(minimapFrame([], view, 216, 120), view));
  });

  it('keeps the view and huge far-away objects inside the map at one scale', () => {
    const view = viewOf(CAMERA);
    const objects = [
      { x: -2_000_000, y: 3_000_000, width: 900_000, height: 10 },
      { x: 4_000_000, y: -5_000_000, width: 1, height: 1_500_000 },
    ];
    const frame = minimapFrame(objects, view, 216, 120);
    for (const rect of [view, ...objects]) expectInside(toMap(frame, rect));
    const mapped = toMap(frame, { x: 0, y: 0, width: 100, height: 100 });
    expect(mapped.width).toBeCloseTo(mapped.height);
    expect(mapped.width / 100).toBeCloseTo(frame.scale);
    expect(mapped.height / 100).toBeCloseTo(frame.scale);
  });

  it('inverts map points, including offsets from letterboxing', () => {
    const frame = minimapFrame(
      [{ x: -100, y: 100, width: 600, height: 20 }],
      viewOf(CAMERA),
      216,
      120,
    );
    for (const point of [
      { x: -100, y: 100 },
      { x: 500, y: 120 },
      { x: 23.5, y: -14 },
    ]) {
      const mapped = toMap(frame, { ...point, width: 0, height: 0 });
      const world = toWorld(frame, mapped.x, mapped.y);
      expect(world.x).toBeCloseTo(point.x);
      expect(world.y).toBeCloseTo(point.y);
    }
  });

  it('centres a target without changing the zoom or view size', () => {
    const target = { x: 900, y: -120 };
    const delta = panToCentre(CAMERA, target);
    const next = {
      ...CAMERA,
      x: CAMERA.x - delta.deltaXPx / CAMERA.zoom,
      y: CAMERA.y - delta.deltaYPx / CAMERA.zoom,
    };
    const view = viewOf(next);
    expect(next.zoom).toBe(CAMERA.zoom);
    expect(view.x + view.width / 2).toBeCloseTo(target.x);
    expect(view.y + view.height / 2).toBeCloseTo(target.y);
  });

  it('uses supplied world bounds for rotated objects and children', () => {
    const objects = [
      { type: 'shape', rotation: Math.PI / 4, x: 0, y: 0, width: 10, height: 10 },
      {
        type: 'sticky',
        parentId: 'section',
        x: 5,
        y: 5,
        width: 10,
        height: 10,
        color: [1, 0, 0, 1],
      },
    ] as unknown as BoardObject[];
    const bounds = [
      { minX: -15, minY: -15, maxX: 15, maxY: 15 },
      { minX: 1_000, minY: 2_000, maxX: 1_100, maxY: 2_050 },
    ];
    const items = minimapItems(objects, (object) => bounds[objects.indexOf(object)]);
    expect(items).toEqual([
      { kind: 'other', x: -15, y: -15, width: 30, height: 30 },
      { kind: 'sticky', color: [1, 0, 0, 1], x: 1_000, y: 2_000, width: 100, height: 50 },
    ]);
    const frame = minimapFrame(items, viewOf(CAMERA), 216, 120);
    for (const item of items) expectInside(toMap(frame, item));
  });
});
