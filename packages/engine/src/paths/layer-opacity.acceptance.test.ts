// Slice C1 (layer opacity): a faded path cannot enter the opaque draw route.
import { describe, expect, it } from 'vitest';

import { isOpaquePathLayer } from './path-draw-cache.js';

describe('path multiplier', () => {
  it('takes the transparency route when a path or an ancestor fades it', () => {
    expect(isOpaquePathLayer(1, 1)).toBe(true);
    expect(isOpaquePathLayer(1, 0.5)).toBe(false);
    expect(isOpaquePathLayer(0.5, 1)).toBe(false);
    expect(isOpaquePathLayer(1, 0)).toBe(false);
  });
});
