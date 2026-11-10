// App projections and watched definitions include effective slot mains.
import { describe, expect, it } from 'vitest';

import { type InstanceObject, type ObjectId } from '@canvas/schema';

import {
  createComponentBoard,
  createRectangle,
  mustRun,
} from '../engine/__fixtures__/component-board.js';
import { mainClosureOf, touchesAny } from '../panels/sections/use-board-changes.js';

import { definitionClosure, expandPreviewScene } from './instance-projection.js';

function swappedBoard() {
  const { store } = createComponentBoard();
  createRectangle(store, 'check-mark', null, { x: 900, y: 100, width: 20, height: 20 });
  mustRun(store, 'createComponent', {
    ids: ['check-mark'],
    name: 'Check',
    componentId: 'check-icon',
  });
  mustRun(store, 'setInstanceOverride', {
    id: 'inst',
    path: 'badge-in-card',
    override: { mainId: 'check-icon' },
  });
  return store;
}

describe('app instance swap walkers', () => {
  it('projects the swapped main and its virtual child for selection and hit testing', () => {
    const store = swappedBoard();
    const board = store.read();
    const placed = board.objects.get('inst' as ObjectId) as InstanceObject;
    const closure = definitionClosure(board, [placed]);
    expect(closure.map(({ id }) => id)).toContain('check-icon');
    expect(closure.map(({ id }) => id)).toContain('check-mark');
    const expanded = expandPreviewScene([placed, ...closure], new Set([placed.id]));
    expect(expanded.get('inst/badge-in-card/check-mark' as ObjectId)).toBeDefined();
  });

  it('watches edits to a swapped main child through the card main closure', () => {
    const store = swappedBoard();
    const watched = mainClosureOf(store, 'card' as ObjectId);
    expect(watched.has('check-icon' as ObjectId)).toBe(true);
    expect(watched.has('check-mark' as ObjectId)).toBe(true);
    expect(
      touchesAny(
        {
          created: [],
          updated: ['check-mark' as ObjectId],
          deleted: [],
          origin: { kind: 'user', userId: 'test' } as never,
          isLocal: false,
        },
        watched,
      ),
    ).toBe(true);
  });
});
