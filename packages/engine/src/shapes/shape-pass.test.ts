import { describe, expect, it } from 'vitest';

import type { BoardObject, Gradient, Shadow } from '@canvas/schema';

import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import type { MeshJobSubmitter } from '../paths/path-mesh-builder.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import type { SceneObject } from '../scene/scene-pass.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import { stickyObject, textObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';
import { createStandardScenePasses } from '../scene/standard-passes.js';

import {
  packShapeInstances,
  SHAPE_INSTANCE_BYTES,
  SHAPE_INSTANCE_FLOATS,
} from './shape-instance-layout.js';
import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from './shape-pass.js';
import { SHAPE_QUAD_VERTEX_COUNT, SHAPE_QUAD_VERTICES } from './shape-pipeline.js';
import {
  shadowPlacementOf,
  shadowSilhouetteOf,
  writeObjectShadowRecord,
  type ShadowSilhouette,
} from './shape-shadow.js';
import { noteInstances } from './sticky-note.js';

const YELLOW = [1, 0.92, 0.55, 1] as const;
const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 } as const;
const STROKE = { color: [0, 0.5, 0, 1] as [number, number, number, number], width: 3 };

/**
 * What casts an object's shadow.
 *
 * @param object - A shape or frame.
 * @returns Its silhouette.
 * @throws {Error} For another object.
 */
function silhouetteOf(object: BoardObject): ShadowSilhouette {
  const silhouette = shadowSilhouetteOf(object);
  if (silhouette === undefined) throw new Error('No silhouette');
  return silhouette;
}

/**
 * The records the pass writes for an object, zero-filled first as the scene gives them.
 *
 * @param target - The object and its world transform.
 * @returns One record per `recordCount`.
 */
function recordsOf(target: SceneObject): number[][] {
  const floats = SDF_SHAPE_PASS.layout.floatsPerRecord;
  return Array.from({ length: SDF_SHAPE_PASS.recordCount(target.object) }, (ignored, index) => {
    const record = new Float32Array(floats);
    SDF_SHAPE_PASS.prepare(record, target, index);
    return Array.from(record);
  });
}

describe('SDF_SHAPE_PASS', () => {
  it('draws a sticky note as two records, shadow then fill, and a painted shape as one', () => {
    expect(SDF_SHAPE_PASS.recordCount(stickyObject('n'))).toBe(2);
    expect(SDF_SHAPE_PASS.recordCount(textObject('t'))).toBe(0);
    expect(SDF_SHAPE_PASS.recordCount(shapeObject('s'))).toBe(1);
    expect(SDF_SHAPE_PASS.recordCount(shapeObject('s', { fill: null, stroke: STROKE }))).toBe(1);
    expect(SDF_SHAPE_PASS.recordCount(shapeObject('s', { fill: null }))).toBe(0);
  });

  it('writes nothing into a record for an object it does not draw', () => {
    const record = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
    SDF_SHAPE_PASS.prepare(record, { object: textObject('t'), transform: IDENTITY }, 0);
    expect(record.every((value) => value === 0)).toBe(true);
  });

  it('flags a sticky note as an occluder, so it hides the text under it', () => {
    expect(SDF_SHAPE_PASS.isOccluder?.(stickyObject('n'))).toBe(true);
    expect(SDF_SHAPE_PASS.isOccluder?.(textObject('t'))).toBe(false);
  });

  it('flags every painted shape, translucent or outline only, so it draws over text below it', () => {
    const flagOf = (fields: Parameters<typeof shapeObject>[1]): boolean | undefined =>
      SDF_SHAPE_PASS.isOccluder?.(shapeObject('s', fields));
    expect(flagOf({ kind: 'ellipse' })).toBe(true);
    expect(flagOf({ fill: [1, 0, 0, 0.5] })).toBe(true);
    expect(flagOf({ fill: null, stroke: STROKE })).toBe(true);
    expect(flagOf({ fill: [1, 0, 0, 0.5], stroke: null })).toBe(true);
  });

  it('neither draws nor flags a shape that paints nothing', () => {
    const clear = { color: [0, 0, 0, 0] as [number, number, number, number], width: 2 };
    const none: [number, number, number, number] = [1, 0, 0, 0];
    const cases: Parameters<typeof shapeObject>[1][] = [
      { fill: null, stroke: null },
      { fill: none, stroke: null },
      { fill: null, stroke: clear },
    ];
    for (const fields of cases) {
      const shape = shapeObject('s', fields);
      expect(SDF_SHAPE_PASS.isOccluder?.(shape)).toBe(false);
      expect(SDF_SHAPE_PASS.recordCount(shape)).toBe(0);
    }
  });

  it("writes a shape's box, fill, corner radius, kind, turn, outline and sides", () => {
    const shape = shapeObject('s', {
      kind: 'rectangle',
      width: 120,
      height: 80,
      fill: [0.5, 0.25, 1, 1],
      stroke: STROKE,
      cornerRadius: 12,
    });
    const [record] = recordsOf({ object: shape, transform: { cos: 0, sin: 1, x: 40, y: 30 } });
    // The shape record, then the clip index and the transparency the scene writes.
    expect(record).toEqual([
      40, 30, 120, 80, 0.5, 0.25, 1, 1, 12, 0, 0, 0, 1, 0, 0.5, 0, 1, 3, 4, 0, 0, 0,
    ]);
  });

  it('writes the fraction of its outline outside the edge, by its alignment', () => {
    const fractions = ([undefined, 'inside', 'center', 'outside'] as const).map((strokeAlign) => {
      const shape = shapeObject('s', {
        stroke: STROKE,
        ...(strokeAlign === undefined ? {} : { strokeAlign }),
      });
      return recordsOf({ object: shape, transform: IDENTITY })[0]?.[19];
    });
    expect(fractions).toEqual([0, 0, 0.5, 1]);
    // An outline-less shape writes none, whatever its alignment.
    const bare = shapeObject('s', { stroke: null, strokeAlign: 'outside' });
    expect(recordsOf({ object: bare, transform: IDENTITY })[0]?.[19]).toBe(0);
  });

  it('writes each kind by its code, a polygon with its sides, and no corner radius but a rectangle', () => {
    const codes = (['ellipse', 'diamond', 'polygon', 'star'] as const).map((kind) => {
      const shape = shapeObject('s', { kind, cornerRadius: 9, sides: 7 });
      const [record] = recordsOf({ object: shape, transform: IDENTITY });
      return [record?.[8], record?.[10], record?.[18]];
    });
    expect(codes).toEqual([
      [0, 1, 7],
      [0, 2, 7],
      [0, 3, 7],
      [0, 4, 7],
    ]);
  });

  it('draws a shadowed shape’s shadow first, then its body', () => {
    const shadow: Shadow = { x: 2, y: 6, blur: 5, spread: 1, color: [0, 0, 0, 0.4] };
    const shape = shapeObject('s', { width: 40, height: 30, shadow });
    const before = structuredClone(shape);
    const target = { object: shape, transform: { cos: 0, sin: 1, x: 40, y: 30 } };
    expect(SDF_SHAPE_PASS.recordCount(shape)).toBe(2);
    const [shadowRecord, body] = recordsOf(target);
    const expected = new Float32Array(SDF_SHAPE_PASS.layout.floatsPerRecord);
    writeObjectShadowRecord(expected, shape, target.transform);
    expect(shadowRecord).toEqual(Array.from(expected));
    expect(body).toEqual(
      recordsOf({ ...target, object: shapeObject('s', { width: 40, height: 30 }) })[0],
    );
    // A retained move places the shadow record at its own box, the body at the shape's origin.
    expect(SDF_SHAPE_PASS.movePlacement?.(target, 0)).toEqual(
      shadowPlacementOf(shadow, silhouetteOf(shape), target.transform),
    );
    expect(SDF_SHAPE_PASS.movePlacement?.(target, 1)).toBe(target.transform);
    const text = { object: textObject('t'), transform: target.transform };
    expect(SDF_SHAPE_PASS.movePlacement?.(text, 0)).toBe(target.transform);
    expect(shape).toEqual(before);
  });

  it('draws a gradient-filled shape’s shadow alone, and no shadow of a shape that paints nothing', () => {
    const shadow: Shadow = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };
    const gradient: Gradient = {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: [1, 0, 0, 1] },
        { offset: 1, color: [0, 0, 1, 1] },
      ],
    };
    const shape = shapeObject('s', { fill: gradient, shadow });
    expect(SDF_SHAPE_PASS.recordCount(shape)).toBe(1);
    const [record] = recordsOf({ object: shape, transform: IDENTITY });
    expect(record?.slice(4, 8)).toEqual(Array.from(new Float32Array([0, 0, 0, 0.25])));
    expect(SDF_SHAPE_PASS.movePlacement?.({ object: shape, transform: IDENTITY }, 0)).toEqual(
      shadowPlacementOf(shadow, silhouetteOf(shape), IDENTITY),
    );
    expect(SDF_SHAPE_PASS.recordCount(shapeObject('s', { fill: null, shadow }))).toBe(0);
  });

  it('writes an outline-only shape with a clear fill', () => {
    const shape = shapeObject('s', { fill: null, stroke: STROKE });
    const [record] = recordsOf({ object: shape, transform: IDENTITY });
    expect(record?.slice(4, 8)).toEqual([0, 0, 0, 0]);
    expect(record?.slice(13, 18)).toEqual([0, 0.5, 0, 1, 3]);
  });

  it("writes an unturned note's records exactly as noteInstances packs them", () => {
    const note = stickyObject('n', { width: 200, height: 240, color: [...YELLOW] });
    const records = recordsOf({ object: note, transform: { cos: 1, sin: 0, x: 10, y: 20 } });
    const expected = new Float32Array(2 * SHAPE_INSTANCE_FLOATS);
    packShapeInstances(noteInstances({ x: 10, y: 20, width: 200, height: 240 }, YELLOW), expected);
    // Each record is the packed shape record and the clip index the scene writes.
    expect(records.map((record) => record.slice(0, SHAPE_INSTANCE_FLOATS))).toEqual([
      Array.from(expected.subarray(0, SHAPE_INSTANCE_FLOATS)),
      Array.from(expected.subarray(SHAPE_INSTANCE_FLOATS)),
    ]);
    expect(records.map((record) => record[SHAPE_INSTANCE_FLOATS])).toEqual([0, 0]);
  });

  it('turns a note with its frame: the shadow is offset in the note frame, the axis is written', () => {
    const note = stickyObject('n', { width: 200, height: 200 });
    const [shadow, fill] = recordsOf({
      object: note,
      transform: { cos: 0, sin: 1, x: 100, y: 50 },
    });
    // A quarter turn clockwise maps the shadow's local corner (4, 10) to (−10, 4).
    expect(shadow?.slice(0, 2)).toEqual([90, 54]);
    expect(shadow?.slice(11, 13)).toEqual([0, 1]);
    expect(fill?.slice(0, 4)).toEqual([100, 50, 200, 200]);
    expect(fill?.slice(11, 13)).toEqual([0, 1]);
  });

  it('draws the shape shader over the unit quad, one record per instance', () => {
    const { pipelineSpec, layout } = SDF_SHAPE_PASS;
    expect(SDF_SHAPE_PASS.name).toBe(SDF_SHAPE_PASS_NAME);
    expect(pipelineSpec.shader).toBe(SDF_SHAPE_SHADER);
    expect(pipelineSpec.vertexCount).toBe(SHAPE_QUAD_VERTEX_COUNT);
    expect(Array.from(pipelineSpec.vertices)).toEqual(SHAPE_QUAD_VERTICES);
    expect(pipelineSpec.blend).toBe('premultiplied');
    expect(layout.byteStride).toBe(SHAPE_INSTANCE_BYTES + 8);
    expect(layout.clipFloat).toBe(SHAPE_INSTANCE_FLOATS);
    expect(layout.opacityFloat).toBe(SHAPE_INSTANCE_FLOATS + 1);
  });

  it('is a standard pass, after the solid rectangles and before paths and text', () => {
    const jobs = {} as MeshJobSubmitter;
    const names = createStandardScenePasses({ jobs }).map((pass) => pass.name);
    // After the frame shadows, the solid rectangles and their gradient and image variants and the
    // rounded frames' backgrounds, the frame outlines and the layer composites,
    // before its own variants.
    expect(names.indexOf(SDF_SHAPE_PASS_NAME)).toBe(8);
    expect(names.slice(9, 11)).toEqual(['sdf-shape-gradient', 'sdf-shape-image']);
  });

  it("draws a note's two records through a scene renderer", () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { passes: [SDF_SHAPE_PASS] });
    const document = new FakeSceneDocument();
    document.create(stickyObject('n'));
    renderer.enqueue(document.takeChanges());
    const camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };
    const stats = renderer.renderFrame({ timeMs: 0, camera });
    expect(renderer.scene.instanceBufferOf(SDF_SHAPE_PASS_NAME).recordCount).toBe(2);
    expect(stats.drawCalls).toBe(1);
  });
});
