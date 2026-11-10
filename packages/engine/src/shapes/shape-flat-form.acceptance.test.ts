// Independent acceptance for the tiny SDF form, before its implementation.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, Shadow } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import type { LevelOfDetail, PassLevelOfDetail } from '../lod/level-of-detail.js';
import * as thresholds from '../lod/lod-thresholds.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject, zKeyAt } from '../scene/__fixtures__/scene-objects.js';
import type { DrawListEntry } from '../scene/draw-list.js';
import type { ScenePass, ScenePassEnvironment, ScenePassFactory } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { stickyObject, textObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';
import type { WorldTransform } from '../scene/world-transform.js';

import * as layout from './shape-instance-layout.js';
import { writeShapeRecord } from './shape-object-record.js';
import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from './shape-pass.js';
import { writeObjectShadowRecord } from './shape-shadow.js';
import { NOTE_CORNER_RADIUS, noteInstances } from './sticky-note.js';

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;
const TURN = { cos: 0, sin: 1, x: 17, y: 29 } as const;
const SHADOW: Shadow = { x: 2, y: 4, blur: 6, spread: 1, color: [0.1, 0.2, 0.3, 0.5] };
const STICKY_COLOR = [0.8, 0.6, 0.2, 0.75] as const;
const FLOATS = layout.SHAPE_INSTANCE_FLOATS;
const CAMERA: Camera = {
  x: 50,
  y: 50,
  zoom: 0.03,
  dpr: 1,
  viewportWidthPx: 200,
  viewportHeightPx: 200,
};

function shapePass(form?: 'full' | 'average-color'): ScenePass {
  const factory = SDF_SHAPE_PASS as unknown as ScenePassFactory;
  expect(typeof factory.create).toBe('function');
  const environment: ScenePassEnvironment = {
    backend: new FakeGpuBackend(),
    requestFrame: () => undefined,
    now: () => 0,
    ...(form === undefined
      ? {}
      : { levelOfDetail: { formOf: () => form } as unknown as LevelOfDetail }),
  };
  return factory.create(environment);
}

function recordsOf(
  pass: ScenePass,
  object: BoardObject,
  transform: WorldTransform = TURN,
): Float32Array[] {
  return Array.from({ length: pass.recordCount(object) }, (unused, index) => {
    const record = new Float32Array(pass.layout.floatsPerRecord);
    pass.prepare(record, { object, transform }, index);
    return record;
  });
}

function firstRecord(records: readonly Float32Array[], index = 0): Float32Array {
  const record = records[index];
  if (!record) throw new Error(`Expected shape record ${String(index)}`);
  return record;
}

function expectFlatBody(
  flat: Float32Array,
  full: Float32Array,
  color: readonly number[],
  fraction: number,
): void {
  expect(flat[10]).toBe(5);
  expect([flat[8], flat[9], flat[17]]).toEqual([0, 0, 0]);
  expect(Array.from(flat.slice(0, 4))).toEqual(Array.from(full.slice(0, 4)));
  expect(Array.from(flat.slice(11, 13))).toEqual(Array.from(full.slice(11, 13)));
  expect(Array.from(flat.slice(4, 7))).toEqual(Array.from(new Float32Array(color.slice(0, 3))));
  expect(flat[7]).toBeCloseTo((color[3] ?? 0) * fraction, 6);
}

function recordIn(renderer: SceneRenderer, id: string, index: number): Float32Array {
  const slot = renderer.scene.slotsOf(id as ObjectId, SDF_SHAPE_PASS_NAME)[index];
  if (slot === undefined) throw new Error(`Missing record ${String(index)} for ${id}`);
  const buffer = renderer.scene.instanceBufferOf(SDF_SHAPE_PASS_NAME);
  return buffer.data.slice(
    slot * buffer.layout.floatsPerRecord,
    slot * buffer.layout.floatsPerRecord + FLOATS,
  );
}

describe('tiny SDF shape form', () => {
  it('registers the 4 device-pixel rule and measures only shape and sticky boxes', () => {
    const rule: unknown = Reflect.get(thresholds, 'SHAPE_LOD_RULE');
    expect(rule).toEqual({ kind: 'shape', levels: [{ form: 'average-color', belowPx: 4 }] });
    const lod: PassLevelOfDetail | undefined = shapePass().levelOfDetail;
    if (!lod) throw new Error('Shape pass has no level-of-detail rule');
    expect(lod.rule).toBe(rule);
    expect(lod.sizeOf(shapeObject('wide', { width: 100, height: 20 }))).toBe(100);
    expect(lod.sizeOf(stickyObject('tall', { width: 20, height: 100 }))).toBe(100);
    expect(lod.sizeOf(textObject('text'))).toBe(0);
    expect(lod.isSameSize?.(shapeObject('a'), shapeObject('b'))).toBe(true);
    expect(lod.isSameSize?.(shapeObject('a'), shapeObject('b', { height: 11 }))).toBe(false);
  });

  it('reserves kind code 5 for flat SDF records', () => {
    const flatKindCode: unknown = Reflect.get(layout, 'SHAPE_FLAT_KIND_CODE');
    expect(flatKindCode).toBe(5);
  });

  it('keeps full records bit-for-bit equal to the existing writers with and without LOD', () => {
    const shape = shapeObject('shape', {
      width: 90,
      height: 50,
      cornerRadius: 9,
      fill: [0.2, 0.4, 0.6, 0.75],
      shadow: SHADOW,
    });
    const sticky = stickyObject('sticky', { width: 100, height: 80, color: [...STICKY_COLOR] });
    const expectedShadow = new Float32Array(FLOATS);
    const expectedBody = new Float32Array(FLOATS);
    writeObjectShadowRecord(expectedShadow, shape, TURN);
    writeShapeRecord(expectedBody, shape, TURN);
    const expectedSticky = new Float32Array(FLOATS * 2);
    layout.packShapeInstances(
      noteInstances({ x: 0, y: 0, width: 100, height: 80 }, STICKY_COLOR),
      expectedSticky,
    );
    for (const form of [undefined, 'full'] as const) {
      const pass = shapePass(form);
      expect(recordsOf(pass, shape).map((record) => Array.from(record.slice(0, FLOATS)))).toEqual([
        Array.from(expectedShadow),
        Array.from(expectedBody),
      ]);
      expect(
        recordsOf(pass, sticky, IDENTITY).map((record) => Array.from(record.slice(0, FLOATS))),
      ).toEqual([
        Array.from(expectedSticky.slice(0, FLOATS)),
        Array.from(expectedSticky.slice(FLOATS)),
      ]);
    }
  });

  it.each([
    ['rectangle', 20, 10, 3, 1 - ((4 - Math.PI) * 9) / 200],
    ['ellipse', 20, 10, 0, Math.PI / 4],
    ['diamond', 20, 10, 0, 0.5],
    ['polygon', 20, 10, 0, 0.5],
    ['star', 20, 10, 0, 0.5],
    ['rectangle', 20, 10, 100, 1 - ((4 - Math.PI) * 25) / 200],
  ] as const)(
    'writes average fill coverage for %s (radius %i)',
    (kind, width, height, cornerRadius, fraction) => {
      const shape = shapeObject('shape', {
        kind,
        width,
        height,
        cornerRadius,
        fill: [0.2, 0.4, 0.6, 0.8],
      });
      expectFlatBody(
        firstRecord(recordsOf(shapePass('average-color'), shape)),
        firstRecord(recordsOf(shapePass('full'), shape)),
        [0.2, 0.4, 0.6, 0.8],
        fraction,
      );
    },
  );

  it('uses the outline when the fill does not paint, and flattens sticky paper coverage', () => {
    const outline = shapeObject('outline', {
      kind: 'ellipse',
      fill: null,
      stroke: { width: 3, color: [0.3, 0.5, 0.7, 0.6] },
    });
    const sticky = stickyObject('sticky', { width: 20, height: 10, color: [...STICKY_COLOR] });
    const flat = shapePass('average-color');
    const full = shapePass('full');
    expectFlatBody(
      firstRecord(recordsOf(flat, outline)),
      firstRecord(recordsOf(full, outline)),
      [0.3, 0.5, 0.7, 0.6],
      // Refined after the first golden (Claude): an outline alone covers its ring's
      // share of the 10 × 10 box too, 1 − (4 × 4) / 100, so a tiny outlined shape keeps its tone.
      (Math.PI / 4) * (1 - 16 / 100),
    );
    const paperFraction = 1 - ((4 - Math.PI) * NOTE_CORNER_RADIUS ** 2) / 200;
    expectFlatBody(
      firstRecord(recordsOf(flat, sticky), 1),
      firstRecord(recordsOf(full, sticky), 1),
      STICKY_COLOR,
      paperFraction,
    );
  });

  it('turns every drawn shadow into a transparent flat record', () => {
    const shape = shapeObject('shape', { shadow: [SHADOW, { ...SHADOW, y: 8 }] });
    const flat = shapePass('average-color');
    const full = shapePass('full');
    for (const [object, count] of [
      [shape, 2],
      [stickyObject('sticky'), 1],
    ] as const) {
      const flatRecords = recordsOf(flat, object);
      const fullRecords = recordsOf(full, object);
      expect(flatRecords).toHaveLength(fullRecords.length);
      for (let index = 0; index < count; index += 1) {
        expect(flatRecords[index]?.[10]).toBe(5);
        expect(flatRecords[index]?.[7]).toBe(0);
      }
    }
  });

  it('rewrites both object forms across the hysteresis band without changing draw-list pass or page', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { passes: [SDF_SHAPE_PASS] });
    const document = new FakeSceneDocument();
    document.create(
      stickyObject('sticky', { width: 100, height: 100, z: zKeyAt(0) }),
      shapeObject('shape', { width: 100, height: 100, x: 120, z: zKeyAt(1) }),
    );
    renderer.enqueue(document.takeChanges());
    let drawList: readonly DrawListEntry[] = [];
    renderer.frame.insertStage('before', 'draw', {
      name: 'captureTinyShapeDrawList',
      run: ({ drawList: entries }) => {
        drawList = [...entries];
      },
    });
    const pages: string[][] = [];
    for (const [index, pixels, kind, transitions] of [
      [0, 3, 5, 0],
      [1, 10, 0, 2],
      [2, 4.5, 0, 0],
      [3, 3.5, 5, 2],
    ] as const) {
      const stats = renderer.renderFrame({
        timeMs: index * 16,
        camera: { ...CAMERA, zoom: pixels / 100 },
      });
      expect(recordIn(renderer, 'sticky', 0)[10]).toBe(kind);
      expect(recordIn(renderer, 'sticky', 1)[10]).toBe(kind);
      expect(recordIn(renderer, 'shape', 0)[10]).toBe(kind);
      expect(stats.lodTransitions).toBe(transitions);
      pages.push(drawList.map(({ passName, page }) => `${passName}:${String(page)}`));
    }
    expect(pages[1]).toEqual(pages[0]);
    expect(pages[2]).toEqual(pages[0]);
    expect(pages[3]).toEqual(pages[0]);
    renderer.destroy();
  });
});
