import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ComponentAction } from '../state/shell-action.js';

import { mountComponentBoard } from './__fixtures__/mounted-component-board.js';

describe('setSwapOptions component action', () => {
  it('runs the document command and undo restores the slot’s prior options', () => {
    const { store, document, run } = mountComponentBoard();
    const action = {
      type: 'component',
      command: 'setSwapOptions',
      id: 'badge-in-card' as ObjectId,
      options: ['badge' as ObjectId],
    } as unknown as ComponentAction;
    expect(run(action)).toBe(true);
    expect(store.get('badge-in-card' as ObjectId)).toMatchObject({ swapOptions: ['badge'] });
    run({ type: 'history', command: 'undo' });
    expect(store.get('badge-in-card' as ObjectId)).not.toHaveProperty('swapOptions');
    document.setEditable(false);
    run(action);
    expect(store.get('badge-in-card' as ObjectId)).not.toHaveProperty('swapOptions');
  });
});
