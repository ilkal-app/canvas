import { describe, expect, it } from 'vitest';

import type { Shadow } from '@canvas/schema';

import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';
import { writeObjectShadowRecord } from '../shapes/shape-shadow.js';

import { frameObject, shapeObject } from './__fixtures__/scene-objects.js';
import { FRAME_SHADOW_PASS, FRAME_SHADOW_PASS_NAME } from './frame-shadow-pass.js';
import { FRAME_SHAPE_INSTANCE_LAYOUT } from './frame-shape-record.js';

const SHADOW: Shadow = { x: 0, y: 8, blur: 16, spread: 4, color: [0, 0, 0, 0.3] };
const TURNED = { cos: 0.6, sin: 0.8, x: 10, y: 20 } as const;

describe('FRAME_SHADOW_PASS', () => {
  it('draws the shape shader with the frame SDF record, under its own name', () => {
    expect(FRAME_SHADOW_PASS.name).toBe(FRAME_SHADOW_PASS_NAME);
    expect(FRAME_SHADOW_PASS.layout).toBe(FRAME_SHAPE_INSTANCE_LAYOUT);
    expect(FRAME_SHADOW_PASS.layout.floatsPerRecord).toBe(
      SDF_SHAPE_PASS.layout.floatsPerRecord + 4,
    );
    expect(FRAME_SHADOW_PASS.pipelineSpec.shader).toBe(SDF_SHAPE_SHADER);
    expect(FRAME_SHADOW_PASS.pipelineSpec.blend).toBe('premultiplied');
  });

  it('gives a shadowed frame with a visible background one flagged record, and nothing else', () => {
    const shadowed = frameObject('f', { shadow: SHADOW });
    expect(FRAME_SHADOW_PASS.recordCount(shadowed)).toBe(1);
    expect(FRAME_SHADOW_PASS.isOccluder?.(shadowed)).toBe(true);
    for (const object of [
      frameObject('f'),
      frameObject('f', { shadow: null }),
      frameObject('f', { background: null, shadow: SHADOW }),
      frameObject('f', { background: [1, 1, 1, 0], shadow: SHADOW }),
      shapeObject('s', { shadow: SHADOW }),
    ]) {
      expect(FRAME_SHADOW_PASS.recordCount(object)).toBe(0);
      expect(FRAME_SHADOW_PASS.isOccluder?.(object)).toBe(false);
    }
  });

  it('writes the frame’s shadow record, turned with the frame', () => {
    const frame = frameObject('f', { shadow: SHADOW, width: 80, height: 60 });
    const floats = FRAME_SHADOW_PASS.layout.floatsPerRecord;
    const record = new Float32Array(floats);
    FRAME_SHADOW_PASS.prepare(record, { object: frame, transform: TURNED }, 0);
    const expected = new Float32Array(floats);
    writeObjectShadowRecord(expected, frame, TURNED);
    expect(record).toEqual(expected);
    expect(Array.from(record.slice(2, 4))).toEqual([88, 68]);
  });
});
