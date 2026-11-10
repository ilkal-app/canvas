import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { id } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import { createGuardedLabel } from './__fixtures__/guarded-label.js';

// Count real earlier-value traversal, not elapsed time or calls to a mock cache. The losing
// label sits between Ada's current label and the null value her step replaced. Each rich-text
// child asks whether that same owner is protected during the actual history undo.
describe('field guard history walk during one undo', () => {
  it('walks the shared label history once rather than once per rich-text child', () => {
    const { ada, bob, history, text } = createGuardedLabel(64);
    const object = internalsOf(ada).objects.get('shape-box');
    if (!(object instanceof Y.Map)) throw new Error('Missing shape map');
    const owner = object._map.get('label');
    const earlier = owner?.left;
    if (earlier === undefined || earlier === null) throw new Error('Missing earlier label');
    expect(earlier.id.client).toBe(1);
    let left = earlier.left;
    let reads = 0;
    Object.defineProperty(earlier, 'left', {
      configurable: true,
      get: () => {
        reads += 1;
        return left;
      },
      set: (value: Y.Item | null) => {
        left = value;
      },
    });
    try {
      history.undo();
      const shape = ada.get(id('shape-box'));
      expect(shape?.type === 'shape' && shape.label?.text).toBe(text);
      expect(ada.read().issues).toEqual([]);
      expect(reads).toBeLessThanOrEqual(4);
    } finally {
      Object.defineProperty(earlier, 'left', { configurable: true, writable: true, value: left });
      history.destroy();
      ada.destroy();
      bob.destroy();
    }
  });
});
