import { describe, expect, it } from 'vitest';

import {
  CLIP_INDEX_LOCATION,
  LAYER_OPACITY_LOCATION,
  resolveInstanceLayout,
  resolveSceneInstanceLayout,
} from './instance-layout.js';

describe('resolveInstanceLayout', () => {
  it('derives the stride and float count from the attribute formats', () => {
    const layout = resolveInstanceLayout([
      { location: 1, format: 'float32x2' },
      { location: 2, format: 'float32' },
      { location: 3, format: 'float32x4' },
    ]);
    expect(layout.floatsPerRecord).toBe(7);
    expect(layout.byteStride).toBe(28);
    expect(layout.vertexBufferLayout.stepMode).toBe('instance');
    expect(layout.vertexBufferLayout.attributes).toHaveLength(3);
  });

  it('rejects packed byte formats, which a Float32Array record cannot hold', () => {
    expect(() => resolveInstanceLayout([{ location: 1, format: 'unorm8x4' }])).toThrow(RangeError);
  });

  it('rejects a layout without attributes', () => {
    expect(() => resolveInstanceLayout([])).toThrow(RangeError);
  });
});

describe('resolveSceneInstanceLayout', () => {
  it("appends the clip index at location 14, then the transparency at 12 as the record's last float", () => {
    const layout = resolveSceneInstanceLayout([
      { location: 1, format: 'float32x2' },
      { location: 8, format: 'float32' },
    ]);
    expect(CLIP_INDEX_LOCATION).toBe(14);
    expect(LAYER_OPACITY_LOCATION).toBe(12);
    expect(layout.floatsPerRecord).toBe(5);
    expect(layout.byteStride).toBe(20);
    expect(layout.clipFloat).toBe(3);
    expect(layout.opacityFloat).toBe(4);
    expect(layout.vertexBufferLayout.attributes.slice(-2)).toEqual([
      { location: 14, format: 'float32' },
      { location: 12, format: 'float32' },
    ]);
  });

  it('leaves a plain layout without a clip float', () => {
    expect(resolveInstanceLayout([{ location: 1, format: 'float32' }]).clipFloat).toBeUndefined();
  });

  it("rejects a pass with no attributes of its own, or one using the clip index's location", () => {
    expect(() => resolveSceneInstanceLayout([])).toThrow(RangeError);
    expect(() => resolveSceneInstanceLayout([{ location: 14, format: 'float32' }])).toThrow(
      RangeError,
    );
  });
});
