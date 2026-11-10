import { describe, expect, it } from 'vitest';

import { INK_COLORS, type Rgba } from '@canvas/schema';

import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import { ColorPalette } from '../paint/color-palette.js';
import { SHAPE_INSTANCE_FLOATS } from '../shapes/shape-instance-layout.js';
import { SHAPE_QUAD_CORNERS } from '../shapes/shape-pipeline.js';

import { frameObject, shapeObject } from './__fixtures__/scene-objects.js';
import { FRAME_SHAPE_INSTANCE_LAYOUT } from './frame-shape-record.js';
import {
  FRAME_STROKE_PASS,
  FRAME_STROKE_PASS_NAME,
  isStrokedFrame,
  writeFrameStrokeRecord,
} from './frame-stroke-pass.js';

const TURNED = { cos: 0.6, sin: 0.8, x: 10, y: 20 } as const;
const RED: Rgba = [1, 0, 0, 0.5];

/**
 * The record the pass writes for a frame, zero-filled first as the scene gives it.
 *
 * @param object - The frame.
 * @param palette - The scene's palette, if any.
 * @returns The record's floats.
 */
function recordOf(
  object: Parameters<typeof FRAME_STROKE_PASS.recordCount>[0],
  palette?: ColorPalette,
): number[] {
  const record = new Float32Array(FRAME_STROKE_PASS.layout.floatsPerRecord);
  FRAME_STROKE_PASS.prepare(
    record,
    { object, transform: TURNED, ...(palette === undefined ? {} : { palette }) },
    0,
  );
  return Array.from(record);
}

describe('FRAME_STROKE_PASS', () => {
  it('draws the shape shader with the frame SDF record, under its own name', () => {
    expect(FRAME_STROKE_PASS.name).toBe(FRAME_STROKE_PASS_NAME);
    expect(FRAME_STROKE_PASS.layout).toBe(FRAME_SHAPE_INSTANCE_LAYOUT);
    expect(FRAME_STROKE_PASS.pipelineSpec.shader).toBe(SDF_SHAPE_SHADER);
    expect(Array.from(FRAME_STROKE_PASS.pipelineSpec.vertices)).toEqual(SHAPE_QUAD_CORNERS);
    expect(FRAME_STROKE_PASS.pipelineSpec.blend).toBe('premultiplied');
    expect(FRAME_STROKE_PASS.isRootMoveEmpty).toBe(true);
  });

  it('gives a frame whose outline paints one flagged record, and nothing else', () => {
    const stroked = frameObject('f', { stroke: { color: RED, width: 2 } });
    expect(isStrokedFrame(stroked)).toBe(true);
    expect(FRAME_STROKE_PASS.recordCount(stroked)).toBe(1);
    expect(FRAME_STROKE_PASS.isOccluder?.(stroked)).toBe(true);
    const inked = frameObject('f', { background: null, stroke: { color: 'ink', width: 1 } });
    expect(FRAME_STROKE_PASS.recordCount(inked)).toBe(1);
    for (const object of [
      frameObject('f'),
      frameObject('f', { stroke: null }),
      frameObject('f', { stroke: { color: [0, 0, 0, 0], width: 2 } }),
      shapeObject('s', { stroke: { color: RED, width: 2 } }),
    ]) {
      expect(FRAME_STROKE_PASS.recordCount(object)).toBe(0);
      expect(FRAME_STROKE_PASS.isOccluder?.(object)).toBe(false);
    }
  });

  it('writes a clear, sharp box with the outline’s colour, width and alignment', () => {
    for (const [strokeAlign, fraction] of [
      [undefined, 0],
      ['inside', 0],
      ['center', 0.5],
      ['outside', 1],
    ] as const) {
      const frame = frameObject('f', {
        width: 80,
        height: 60,
        stroke: { color: RED, width: 3 },
        ...(strokeAlign === undefined ? {} : { strokeAlign }),
      });
      const record = recordOf(frame);
      expect(record.slice(0, SHAPE_INSTANCE_FLOATS)).toEqual(
        Array.from(
          new Float32Array([
            10,
            20,
            80,
            60,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0.6,
            0.8,
            1,
            0,
            0,
            0.5,
            3,
            0,
            fraction,
          ]),
        ),
      );
    }
  });

  it('resolves ink to the scene’s ink, the light theme’s by default', () => {
    const frame = frameObject('f', { stroke: { color: 'ink', width: 1 } });
    expect(recordOf(frame).slice(13, 17)).toEqual(Array.from(new Float32Array(INK_COLORS.light)));
    expect(recordOf(frame, new ColorPalette('dark')).slice(13, 17)).toEqual(
      Array.from(new Float32Array(INK_COLORS.dark)),
    );
  });

  it('leaves the record clear for anything it does not draw, without mutating the frame', () => {
    const frame = frameObject('f', { stroke: { color: [0, 0, 0, 0], width: 2 } });
    const before = structuredClone(frame);
    expect(recordOf(frame).every((value) => value === 0)).toBe(true);
    expect(recordOf(shapeObject('s')).every((value) => value === 0)).toBe(true);
    const record = new Float32Array(SHAPE_INSTANCE_FLOATS);
    writeFrameStrokeRecord(record, frameObject('f'), TURNED);
    expect(record.every((value) => value === 0)).toBe(true);
    expect(frame).toEqual(before);
  });
});
