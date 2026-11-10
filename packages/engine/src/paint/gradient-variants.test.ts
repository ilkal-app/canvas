import { describe, expect, it } from 'vitest';

import {
  INK_COLORS,
  paintAverageColor,
  paintBoxOf,
  type Gradient,
  type PathObject,
} from '@canvas/schema';

import type { LevelOfDetail } from '../lod/level-of-detail.js';
import { squarePath } from '../paths/__fixtures__/path-scene.js';
import { INLINE_MESH_BUILDER } from '../paths/path-mesh-builder.js';
import { createGradientPathPass, createPathPass } from '../paths/path-pass.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject } from '../scene/__fixtures__/scene-objects.js';
import { RECT_GRADIENT_PASS } from '../scene/rect-gradient-pass.js';
import type { ScenePassEnvironment } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';

import { ColorPalette } from './color-palette.js';

const DARK_PALETTE = new ColorPalette('dark');

const TRANSFORM = { cos: 0.6, sin: 0.8, x: 5, y: 7 };

const RADIAL: Gradient = {
  type: 'radial',
  center: { x: 0.5, y: 0.5 },
  radius: 0.5,
  stops: [
    { offset: 0, color: [1, 1, 1, 1] },
    { offset: 1, color: [0, 0, 0, 0.5] },
  ],
};

function environmentWith(form?: string): ScenePassEnvironment {
  return {
    backend: new FakeGpuBackend(),
    requestFrame: () => undefined,
    now: () => 0,
    ...(form === undefined
      ? {}
      : { levelOfDetail: { formOf: () => form } as unknown as LevelOfDetail }),
  };
}

const PATH_PASS = createPathPass({ meshBuilder: INLINE_MESH_BUILDER });

describe('the gradient path pass', () => {
  const gradientPass = (form?: string) =>
    createGradientPathPass({ meshBuilder: INLINE_MESH_BUILDER }).create(environmentWith(form));

  it('takes paths with a gradient fill, fill and stroke, from the path pass', () => {
    const pass = gradientPass();
    const gradient = squarePath('g', 0, { fill: RADIAL });
    const solid = squarePath('s', 0);
    expect(pass.name).toBe('path-gradient');
    expect([pass.recordCount(gradient), PATH_PASS.recordCount(gradient)]).toEqual([2, 0]);
    expect([pass.recordCount(solid), PATH_PASS.recordCount(solid)]).toEqual([0, 2]);
    expect(pass.isOccluder?.(gradient)).toBe(true);
    expect(pass.pipelineSpec.pageBindings).toEqual([{ binding: 1, kind: 'load-texture' }]);
  });

  it('writes the fill layer’s paint box and paint record, the stroke its resolved colour', () => {
    const pass = gradientPass();
    const path: PathObject = squarePath('g', 0, {
      fill: RADIAL,
      stroke: { color: 'ink', width: 2 },
    });
    const fill = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(fill, { object: path, transform: TRANSFORM }, 0);
    const box = paintBoxOf(path);
    expect([...fill]).toEqual(
      // The paint record, then the clip index and transparency the scene writes (0 until it does).
      [0.6, 0.8, 5, 7, box.x, box.y, 1 / box.width, 1 / box.height, 1, 0, 0].map(Math.fround),
    );
    const stroke = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(stroke, { object: path, transform: TRANSFORM, palette: DARK_PALETTE }, 1);
    expect([...stroke.subarray(4)]).toEqual([...INK_COLORS.dark, 0, 0, 0].map(Math.fround));
  });

  it('maps an axis of zero extent to 0.5 (inverse 0) and draws the chord form’s average', () => {
    const flat = squarePath('g', 0, { fill: RADIAL });
    const pass = gradientPass('chord');
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object: flat, transform: TRANSFORM }, 0);
    expect(record[8]).toBe(0);
    expect([...record.subarray(4, 8)]).toEqual([...paintAverageColor(RADIAL)].map(Math.fround));
    const line = {
      ...flat,
      vertices: flat.vertices.map((vertex) => ({ ...vertex, y: 0 })),
    } as PathObject;
    const full = gradientPass();
    full.prepare(record, { object: line, transform: TRANSFORM }, 0);
    expect(record[7]).toBe(0);
  });
});

describe('RECT_GRADIENT_PASS', () => {
  const frame = frameObject('f', { width: 80, height: 40, background: RADIAL });

  it('draws gradient backgrounds the solid-rect pass leaves', () => {
    const pass = RECT_GRADIENT_PASS.create(environmentWith());
    expect([pass.recordCount(frame), SOLID_RECT_PASS.recordCount(frame)]).toEqual([1, 0]);
    const solid = frameObject('s');
    expect([pass.recordCount(solid), SOLID_RECT_PASS.recordCount(solid)]).toEqual([0, 1]);
    expect(pass.isOccluder?.(frame)).toBe(true);
    const clear: Gradient = {
      ...RADIAL,
      stops: RADIAL.stops.map((stop) => ({ ...stop, color: [0, 0, 0, 0] })),
    };
    expect(pass.isOccluder?.({ ...frame, background: clear })).toBe(false);
  });

  it('writes the solid-rect record and its paint record, or the average in the cheap form', () => {
    const record = new Float32Array(11);
    RECT_GRADIENT_PASS.create(environmentWith()).prepare(
      record,
      { object: frame, transform: TRANSFORM },
      0,
    );
    expect([...record]).toEqual([5, 7, 80, 40, 0.6, 0.8, 0, 0, 0, 0, 1].map(Math.fround));
    RECT_GRADIENT_PASS.create(environmentWith('average-color')).prepare(
      record,
      { object: frame, transform: TRANSFORM },
      0,
    );
    expect([...record.subarray(6)]).toEqual([...paintAverageColor(RADIAL), 0].map(Math.fround));
  });

  it('shares one paint table between the gradient passes of a renderer', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [
        SOLID_RECT_PASS,
        RECT_GRADIENT_PASS,
        createGradientPathPass({ meshBuilder: INLINE_MESH_BUILDER }),
      ],
    });
    const document = new FakeSceneDocument();
    document.create(frame, squarePath('p', 1, { fill: RADIAL }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({
      timeMs: 0,
      camera: { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 },
    });
    expect(backend.textures.filter(({ label }) => label === 'paint-table')).toHaveLength(1);
    renderer.destroy();
    expect(backend.textures.every(({ isDestroyed }) => isDestroyed)).toBe(true);
  });
});
