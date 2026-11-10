import { describe, expect, it } from 'vitest';

import { id } from './__fixtures__/select-board.js';
import { readOnlyIntentsOf } from './read-only-intents.js';
import type { SelectIntent } from './select-intent.js';

const FRAME = { x: 0, y: 0, width: 10, height: 10, rotation: 0 };

describe('readOnlyIntentsOf', () => {
  it('keeps the intents that only look: select, toggle, marquee, activate, the menu, the double-tap', () => {
    const looking: SelectIntent[] = [
      { type: 'select', ids: [id('a')] },
      { type: 'toggle', id: id('a') },
      {
        type: 'marquee',
        rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        mode: 'intersect',
        ids: [],
      },
      { type: 'activate', id: id('a'), world: { x: 1, y: 1 } },
      { type: 'contextMenu', screen: { x: 1, y: 1 }, world: { x: 1, y: 1 } },
      { type: 'doubleTap', fit: 'board' },
      { type: 'cancel' },
    ];
    expect(readOnlyIntentsOf(looking)).toEqual(looking);
  });

  it('drops every transform and turns a gesture’s commit into a cancel', () => {
    const editing: SelectIntent[] = [
      { type: 'move', delta: { x: 5, y: 0 }, isAxisLocked: false },
      {
        type: 'resize',
        handle: 'se',
        delta: { x: 5, y: 5 },
        isProportional: false,
        from: FRAME,
        to: { ...FRAME, width: 15, height: 15 },
      },
      { type: 'rotate', angle: 1, isSnapped: false, pivot: { x: 5, y: 5 }, from: FRAME },
      { type: 'nudge', delta: { x: 1, y: 0 } },
      { type: 'commit' },
    ];
    expect(readOnlyIntentsOf(editing)).toEqual([{ type: 'cancel' }]);
  });

  it('leaves its input as it was', () => {
    const intents: readonly SelectIntent[] = Object.freeze([{ type: 'commit' } as const]);
    readOnlyIntentsOf(intents);
    expect(intents).toEqual([{ type: 'commit' }]);
  });
});
