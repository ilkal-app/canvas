import { describe, expect, it } from 'vitest';

import { paintAverageColor, type Gradient, type ObjectId, type ShapeObject } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import type { LevelOfDetail } from '../lod/level-of-detail.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from '../scene/__fixtures__/scene-objects.js';
import type { ScenePass, ScenePassEnvironment } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { SHAPE_GRADIENT_INSTANCE_LAYOUT, SDF_SHAPE_GRADIENT_PASS } from './shape-gradient-pass.js';
import { SHAPE_INSTANCE_FLOATS } from './shape-instance-layout.js';
import { isPaintedShape } from './shape-object-record.js';
import { SDF_SHAPE_PASS } from './shape-pass.js';

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

const linear = (alpha: number): Gradient => ({
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, alpha] },
    { offset: 1, color: [0, 0, 1, alpha] },
  ],
});

const gradientShape = (id: string, fields: Partial<ShapeObject> = {}) =>
  shapeObject(id, { fill: linear(1), ...fields });

function passWith(form?: string): ScenePass {
  const environment: ScenePassEnvironment = {
    backend: new FakeGpuBackend(),
    requestFrame: () => undefined,
    now: () => 0,
    ...(form === undefined
      ? {}
      : { levelOfDetail: { formOf: () => form } as unknown as LevelOfDetail }),
  };
  return SDF_SHAPE_GRADIENT_PASS.create(environment);
}

function recordOf(pass: ScenePass, shape: ShapeObject): Float32Array {
  const record = new Float32Array(pass.layout.floatsPerRecord);
  pass.prepare(record, { object: shape, transform: IDENTITY }, 0);
  return record;
}

describe('SDF_SHAPE_GRADIENT_PASS', () => {
  it('draws gradient-filled shapes the solid pass leaves, one record each', () => {
    const pass = passWith();
    const solid = shapeObject('solid');
    const gradient = gradientShape('gradient');
    expect([pass.recordCount(solid), SDF_SHAPE_PASS.recordCount(solid)]).toEqual([0, 1]);
    expect([pass.recordCount(gradient), SDF_SHAPE_PASS.recordCount(gradient)]).toEqual([1, 0]);
    expect(pass.isOccluder?.(gradient)).toBe(true);
    expect(SDF_SHAPE_PASS.isOccluder?.(gradient)).toBe(false);
  });

  it('is the SDF shape record plus one float, its paint record at location 8, then the clip index and transparency', () => {
    expect(SHAPE_GRADIENT_INSTANCE_LAYOUT.floatsPerRecord).toBe(SHAPE_INSTANCE_FLOATS + 3);
    expect(SHAPE_GRADIENT_INSTANCE_LAYOUT.vertexBufferLayout.attributes.slice(-3)).toEqual([
      { location: 8, format: 'float32' },
      { location: 14, format: 'float32' },
      { location: 12, format: 'float32' },
    ]);
    expect(SHAPE_GRADIENT_INSTANCE_LAYOUT.clipFloat).toBe(SHAPE_INSTANCE_FLOATS + 1);
    expect(SHAPE_GRADIENT_INSTANCE_LAYOUT.opacityFloat).toBe(SHAPE_INSTANCE_FLOATS + 2);
  });

  it('writes the solid record with a clear fill and its paint record', () => {
    const pass = passWith();
    const stroke = { color: [0, 0.5, 0, 1] as [number, number, number, number], width: 3 };
    const record = recordOf(pass, gradientShape('g', { stroke, width: 40, height: 20 }));
    const solid = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
    SDF_SHAPE_PASS.prepare(
      solid,
      {
        object: shapeObject('g', { fill: null, stroke, width: 40, height: 20 }),
        transform: IDENTITY,
      },
      0,
    );
    expect(Array.from(record.subarray(0, SHAPE_INSTANCE_FLOATS))).toEqual(
      Array.from(solid.subarray(0, SHAPE_INSTANCE_FLOATS)),
    );
    expect(record[SHAPE_INSTANCE_FLOATS]).toBe(1);
  });

  it('draws the average colour through record 0 below the level-of-detail threshold', () => {
    const pass = passWith('average-color');
    const record = recordOf(pass, gradientShape('g', { fill: linear(0.5) }));
    expect(record[SHAPE_INSTANCE_FLOATS]).toBe(0);
    expect(Array.from(record.subarray(4, 8))).toEqual(
      Array.from(new Float32Array(paintAverageColor(linear(0.5)))),
    );
  });

  it('leaves a gradient the schema refuses to the solid pass, as no fill', () => {
    const pass = passWith();
    const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 2 };
    const bad = shapeObject('bad', {
      fill: { ...linear(1), angle: 9 } as Gradient,
      stroke,
    });
    expect(pass.recordCount(bad)).toBe(0);
    expect(SDF_SHAPE_PASS.recordCount(bad)).toBe(1);
    const record = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
    SDF_SHAPE_PASS.prepare(record, { object: bad, transform: IDENTITY }, 0);
    expect(Array.from(record.subarray(4, 8))).toEqual([0, 0, 0, 0]);
    expect(Array.from(record.subarray(13, 18))).toEqual([0, 0, 0, 1, 2]);
  });

  it('allocates no paint table and draws nothing for a board without a gradient', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [SDF_SHAPE_PASS, SDF_SHAPE_GRADIENT_PASS],
    });
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b', { x: 20, z: zKeyAt(1) }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(backend.textures.filter(({ label }) => label === 'paint-table')).toEqual([]);
    expect(renderer.scene.instanceBufferOf('sdf-shape-gradient').recordCount).toBe(0);
  });

  it('uploads the table once, then nothing on a camera-only frame', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [SDF_SHAPE_PASS, SDF_SHAPE_GRADIENT_PASS],
    });
    const document = new FakeSceneDocument();
    document.create(gradientShape('a'), shapeObject('b', { x: 20, z: zKeyAt(1) }));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(backend.textures.filter(({ label }) => label === 'paint-table')).toHaveLength(1);
    expect(backend.count('writeTexture')).toBe(1);
    expect(backend.draws().length).toBeGreaterThanOrEqual(2);
    backend.resetCalls();
    const stats = renderer.renderFrame({ timeMs: 16, camera: { ...CAMERA, x: 5 } });
    expect(stats.uploadedBytes).toBe(32);
    expect(backend.count('writeTexture')).toBe(0);
  });

  it('frees a record when its shape stops being a gradient, and the table with the renderer', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [SDF_SHAPE_PASS, SDF_SHAPE_GRADIENT_PASS],
    });
    const document = new FakeSceneDocument();
    document.create(gradientShape('a'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    document.update('a', { fill: [0, 1, 0, 1] });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(renderer.scene.slotsOf('a' as ObjectId, 'sdf-shape')).toHaveLength(1);
    expect(renderer.scene.slotsOf('a' as ObjectId, 'sdf-shape-gradient')).toHaveLength(0);
    renderer.destroy();
    expect(backend.textures.find(({ label }) => label === 'paint-table')?.isDestroyed).toBe(true);
  });
});

describe('isPaintedShape', () => {
  const stroke = (color: unknown, width = 2) =>
    ({ color, width }) as unknown as ShapeObject['stroke'];

  it.each([
    ['a solid fill with alpha', shapeObject('s'), true],
    ['a transparent solid fill', shapeObject('s', { fill: [1, 0, 0, 0] }), false],
    [
      'a gradient with one visible stop',
      gradientShape('s', {
        fill: {
          ...linear(0),
          stops: [
            { offset: 0, color: [0, 0, 0, 0] },
            { offset: 1, color: [0, 0, 0, 0.1] },
          ],
        },
      }),
      true,
    ],
    ['a fully transparent gradient', gradientShape('s', { fill: linear(0) }), false],
    [
      'a transparent gradient with an ink outline',
      gradientShape('s', { fill: linear(0), stroke: stroke('ink') }),
      true,
    ],
    ['an ink outline alone', shapeObject('s', { fill: null, stroke: stroke('ink') }), true],
    [
      'an ink outline of width 0',
      shapeObject('s', { fill: null, stroke: stroke('ink', 0) }),
      false,
    ],
    [
      'an unreadable outline colour, drawn in the base colour',
      shapeObject('s', { fill: null, stroke: stroke('Ink') }),
      true,
    ],
    [
      'a transparent outline',
      shapeObject('s', { fill: null, stroke: stroke([0, 0, 0, 0]) }),
      false,
    ],
    [
      'a refused gradient',
      shapeObject('s', { fill: { ...linear(1), radius: 1 } as unknown as Gradient }),
      false,
    ],
  ])('%s', (name, shape, isExpected) => {
    expect(isPaintedShape(shape)).toBe(isExpected);
  });
});
