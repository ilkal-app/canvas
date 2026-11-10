import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { compareStacking } from './stacking-order.js';

const sibling = (id: string, z: string) => ({ id: id as ObjectId, z });

describe('compareStacking', () => {
  it('stacks siblings by z, then by id when two keys are equal', () => {
    const siblings = [sibling('b', 'a0'), sibling('c', 'a1'), sibling('a', 'a0')];
    expect([...siblings].sort(compareStacking).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('agrees with the document package on a fixture of keys and ids', () => {
    // compareStacking is the schema's compareSiblings, which the document sorts by too;
    // `sibling-order-agreement.test.ts` checks the two on a wider fixture.
    const fixture = [
      sibling('n2', 'a1'),
      sibling('n1', 'a1'),
      sibling('x', 'Zz'),
      sibling('y', 'a0V'),
      sibling('z', 'a0'),
    ];
    expect([...fixture].sort(compareStacking).map(({ id }) => id)).toEqual([
      'x',
      'z',
      'y',
      'n1',
      'n2',
    ]);
  });
});
