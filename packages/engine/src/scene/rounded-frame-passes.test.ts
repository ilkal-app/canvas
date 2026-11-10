import { describe, expect, it } from 'vitest';

import { paintAverageColor, type Gradient, type ObjectId, type Shadow } from '@canvas/schema';

import type { LevelOfDetail } from '../lod/level-of-detail.js';
import { SHAPE_INSTANCE_FLOATS } from '../shapes/shape-instance-layout.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { writeObjectShadowRecord } from '../shapes/shape-shadow.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject, shapeObject } from './__fixtures__/scene-objects.js';
import { FRAME_SHADOW_PASS } from './frame-shadow-pass.js';
import {
  FRAME_CORNER_RADII_FLOAT,
  FRAME_SHAPE_FLOATS,
  FRAME_SHAPE_INSTANCE_LAYOUT,
  frameRadiiOf,
  isRoundedFrame,
  writeFrameCornerRadii,
} from './frame-shape-record.js';
import { FRAME_STROKE_PASS } from './frame-stroke-pass.js';
import { RECT_GRADIENT_PASS } from './rect-gradient-pass.js';
import {
  ROUNDED_RECT_GRADIENT_PASS,
  ROUNDED_RECT_GRADIENT_PASS_NAME,
  ROUNDED_RECT_PASS,
  ROUNDED_RECT_PASS_NAME,
} from './rounded-rect-pass.js';
import type { ScenePassEnvironment } from './scene-pass.js';
import { SceneRenderer } from './scene-renderer.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

// A frame's corner radii in every SDF record it draws, and its rounded backgrounds.

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;
const TURNED = { cos: 0, sin: 1, x: 5, y: 6 } as const;
const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };

const GRADIENT: Gradient = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

const rounded = (fields: Parameters<typeof frameObject>[1] = {}) =>
  frameObject('r', { width: 120, height: 80, cornerRadius: [4, 0, 100, 12], ...fields });

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

function radiiOf(record: Float32Array): number[] {
  return [...record.slice(FRAME_CORNER_RADII_FLOAT, FRAME_CORNER_RADII_FLOAT + 4)];
}

describe('frame SDF records', () => {
  it('extends the shape record with four corner radii before the clip index', () => {
    expect(FRAME_SHAPE_INSTANCE_LAYOUT.floatsPerRecord).toBe(FRAME_SHAPE_FLOATS + 2);
    expect(FRAME_SHAPE_INSTANCE_LAYOUT.clipFloat).toBe(FRAME_SHAPE_FLOATS);
    expect(FRAME_SHAPE_INSTANCE_LAYOUT.opacityFloat).toBe(FRAME_SHAPE_FLOATS + 1);
    expect(FRAME_CORNER_RADII_FLOAT).toBe(SHAPE_INSTANCE_FLOATS);
  });

  it('reads a frame as rounded when a capped corner is above 0', () => {
    expect(isRoundedFrame(rounded())).toBe(true);
    expect(isRoundedFrame(frameObject('f'))).toBe(false);
    expect(isRoundedFrame(frameObject('f', { cornerRadius: 0 }))).toBe(false);
    expect(isRoundedFrame(shapeObject('s'))).toBe(false);
    expect(frameRadiiOf(rounded())).toEqual([4, 0, 40, 12]);
  });

  it('grows rounded corners and keeps sharp ones sharp', () => {
    const record = new Float32Array(FRAME_SHAPE_FLOATS);
    writeFrameCornerRadii(record, [4, 0, 40, 12], 3);
    expect(radiiOf(record)).toEqual([7, 0, 43, 15]);
    writeFrameCornerRadii(record, [4, 0, 40, 12], -10);
    expect(radiiOf(record)).toEqual([0, 0, 30, 2]);
  });

  it('rounds a frame’s outline and leaves a sharp one’s radii zero', () => {
    const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 2 };
    const record = new Float32Array(FRAME_STROKE_PASS.layout.floatsPerRecord);
    FRAME_STROKE_PASS.prepare(record, { object: rounded({ stroke }), transform: IDENTITY }, 0);
    expect(radiiOf(record)).toEqual([4, 0, 40, 12]);
    record.fill(0);
    FRAME_STROKE_PASS.prepare(
      record,
      { object: frameObject('f', { stroke }), transform: IDENTITY },
      0,
    );
    expect(radiiOf(record)).toEqual([0, 0, 0, 0]);
  });

  it('rounds a frame’s shadow, its radii grown by the spread', () => {
    const shadow: Shadow = { x: 0, y: 4, blur: 0, spread: 2, color: [0, 0, 0, 0.5] };
    const record = new Float32Array(FRAME_SHADOW_PASS.layout.floatsPerRecord);
    FRAME_SHADOW_PASS.prepare(record, { object: rounded({ shadow }), transform: IDENTITY }, 0);
    expect(radiiOf(record)).toEqual([6, 0, 42, 14]);
    expect(record[8]).toBe(0);
    // A shape's shadow record keeps its 20 floats and its clip index after them.
    const shapeRecord = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
    writeObjectShadowRecord(shapeRecord, shapeObject('s', { shadow }), IDENTITY);
    expect(shapeRecord[SHAPE_INSTANCE_FLOATS]).toBe(0);
  });
});

describe('ROUNDED_RECT_PASS', () => {
  it('takes a rounded frame’s solid background from the solid-rect pass', () => {
    const frame = rounded();
    expect(ROUNDED_RECT_PASS.name).toBe(ROUNDED_RECT_PASS_NAME);
    expect([ROUNDED_RECT_PASS.recordCount(frame), SOLID_RECT_PASS.recordCount(frame)]).toEqual([
      1, 0,
    ]);
    expect(ROUNDED_RECT_PASS.isOccluder?.(frame)).toBe(true);
    const sharp = frameObject('f');
    expect([ROUNDED_RECT_PASS.recordCount(sharp), SOLID_RECT_PASS.recordCount(sharp)]).toEqual([
      0, 1,
    ]);
    expect(ROUNDED_RECT_PASS.recordCount(rounded({ background: null }))).toBe(0);
    expect(ROUNDED_RECT_PASS.recordCount(rounded({ background: GRADIENT }))).toBe(0);
    expect(ROUNDED_RECT_PASS.isOccluder?.(shapeObject('s'))).toBe(false);
  });

  it('writes the box, its colour and its capped radii as a rounded box', () => {
    const record = new Float32Array(ROUNDED_RECT_PASS.layout.floatsPerRecord);
    const frame = rounded({ background: [0.5, 0.25, 1, 0.75] });
    ROUNDED_RECT_PASS.prepare(record, { object: frame, transform: TURNED }, 0);
    expect([...record.slice(0, 8)]).toEqual([5, 6, 120, 80, 0.5, 0.25, 1, 0.75]);
    expect([record[8], record[10], record[11], record[12], record[17]]).toEqual([0, 0, 0, 1, 0]);
    expect(radiiOf(record)).toEqual([4, 0, 40, 12]);
    record.fill(0);
    ROUNDED_RECT_PASS.prepare(record, { object: shapeObject('s'), transform: IDENTITY }, 0);
    expect(record.every((value) => value === 0)).toBe(true);
  });
});

describe('ROUNDED_RECT_GRADIENT_PASS', () => {
  it('takes a rounded frame’s gradient from the rect-gradient pass', () => {
    const pass = ROUNDED_RECT_GRADIENT_PASS.create(environmentWith());
    const sharpPass = RECT_GRADIENT_PASS.create(environmentWith());
    const frame = rounded({ background: GRADIENT });
    expect(pass.name).toBe(ROUNDED_RECT_GRADIENT_PASS_NAME);
    expect([pass.recordCount(frame), sharpPass.recordCount(frame)]).toEqual([1, 0]);
    expect(pass.isOccluder?.(frame)).toBe(true);
    const sharp = frameObject('f', { background: GRADIENT });
    expect([pass.recordCount(sharp), sharpPass.recordCount(sharp)]).toEqual([0, 1]);
    expect(pass.isOccluder?.(rounded())).toBe(false);
    pass.destroy?.();
    sharpPass.destroy?.();
  });

  it('writes the rounded box and its paint record, or the average colour when cheap', () => {
    const pass = ROUNDED_RECT_GRADIENT_PASS.create(environmentWith());
    const record = new Float32Array(pass.layout.floatsPerRecord);
    const frame = rounded({ background: GRADIENT });
    pass.prepare(record, { object: frame, transform: IDENTITY }, 0);
    expect(record[FRAME_SHAPE_FLOATS]).toBeGreaterThan(0);
    expect([...record.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect(radiiOf(record)).toEqual([4, 0, 40, 12]);
    pass.forget?.(frame.id);
    record.fill(0);
    pass.prepare(record, { object: rounded(), transform: IDENTITY }, 0);
    expect(record.every((value) => value === 0)).toBe(true);
    pass.destroy?.();

    const cheap = ROUNDED_RECT_GRADIENT_PASS.create(environmentWith('average-color'));
    cheap.prepare(record, { object: frame, transform: IDENTITY }, 0);
    expect(record[FRAME_SHAPE_FLOATS]).toBe(0);
    expect([...record.slice(4, 8)]).toEqual([...new Float32Array(paintAverageColor(GRADIENT))]);
    cheap.destroy?.();
  });

  it('draws rounded frames through a renderer whose board preview accepts every pass', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [
        FRAME_SHADOW_PASS,
        SOLID_RECT_PASS,
        RECT_GRADIENT_PASS,
        ROUNDED_RECT_PASS,
        ROUNDED_RECT_GRADIENT_PASS,
        FRAME_STROKE_PASS,
      ],
    });
    const document = new FakeSceneDocument();
    const stroke = { color: [0, 0, 0, 1] as [number, number, number, number], width: 2 };
    const shadow: Shadow = { x: 2, y: 2, blur: 0, spread: 0, color: [0, 0, 0, 0.5] };
    document.create(
      rounded({ stroke, shadow }),
      frameObject('g', { x: 200, cornerRadius: [0, 4, 8, 12], background: GRADIENT, stroke }),
      frameObject('s', { x: 400, background: GRADIENT, shadow }),
    );
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(renderer.scene.slotsOf('r' as ObjectId, ROUNDED_RECT_PASS_NAME)).toHaveLength(1);
    expect(renderer.scene.slotsOf('g' as ObjectId, ROUNDED_RECT_GRADIENT_PASS_NAME)).toHaveLength(
      1,
    );
    expect(renderer.readPreviewResources(CAMERA, 'fonts')).toMatchObject({ frameIndex: 0 });
    renderer.destroy();
  });
});
