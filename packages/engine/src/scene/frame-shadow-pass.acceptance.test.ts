// Acceptance, written before the code.
import { describe, expect, it } from 'vitest';

import type { Shadow } from '@canvas/schema';

import { frameObject } from './__fixtures__/scene-objects.js';
import { FRAME_SHADOW_PASS } from './frame-shadow-pass.js';

const LOW: Shadow = { x: 0, y: 8, blur: 24, spread: 0, color: [0, 0, 0, 0.34] };
const HIGH: Shadow = { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] };
const TRANSFORM = { cos: 0, sin: 1, x: 80, y: 40 } as const;

function record(shadow: Shadow | Shadow[], index: number): Float32Array {
  const output = new Float32Array(FRAME_SHADOW_PASS.layout.floatsPerRecord);
  FRAME_SHADOW_PASS.prepare(
    output,
    {
      object: frameObject('frame', { shadow, width: 80, height: 60 }),
      transform: TRANSFORM,
    },
    index,
  );
  return output;
}

describe('FRAME_SHADOW_PASS layered shadows', () => {
  it('writes one record per layer, in stored order, matching single-layer records', () => {
    const frame = frameObject('layered', { shadow: [LOW, HIGH] });
    expect(FRAME_SHADOW_PASS.recordCount(frame)).toBe(2);
    expect(FRAME_SHADOW_PASS.isOccluder?.(frame)).toBe(true);
    expect(record([LOW, HIGH], 0)).toEqual(record(LOW, 0));
    expect(record([LOW, HIGH], 1)).toEqual(record(HIGH, 0));
    expect(record([LOW, HIGH], 0)).not.toEqual(record([LOW, HIGH], 1));
  });

  it('omits fully transparent layers and unpainted frames', () => {
    const clear: Shadow = { ...HIGH, color: [0, 0, 0, 0] };
    expect(FRAME_SHADOW_PASS.recordCount(frameObject('frame', { shadow: [clear, HIGH] }))).toBe(1);
    expect(
      FRAME_SHADOW_PASS.recordCount(
        frameObject('empty', { background: null, shadow: [LOW, HIGH] }),
      ),
    ).toBe(0);
  });
});
