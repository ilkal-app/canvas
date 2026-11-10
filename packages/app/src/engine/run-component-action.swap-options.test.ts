import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { mountComponentBoard } from './__fixtures__/mounted-component-board.js';

describe('setSwapOptions with null', () => {
  it('clears a slot’s options so any live main may be swapped in', () => {
    const { store, run } = mountComponentBoard();
    const id = 'badge-in-card' as ObjectId;
    run({ type: 'component', command: 'setSwapOptions', id, options: ['badge' as ObjectId] });
    expect(store.get(id)).toMatchObject({ swapOptions: ['badge'] });
    expect(run({ type: 'component', command: 'setSwapOptions', id, options: null })).toBe(true);
    expect(store.get(id)).not.toHaveProperty('swapOptions');
  });
});
