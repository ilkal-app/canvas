// Acceptance: the source slot identity stays fixed while its virtual content changes.
import { describe, expect, it } from 'vitest';

import { resolveInstance } from '@canvas/schema';

import {
  boardOf,
  component,
  frame,
  instance,
  path,
  shape,
  text,
} from './__fixtures__/component-board.js';

function buttonBoard(
  overrides: Record<string, unknown> = {},
  target: object = component('icon-b'),
) {
  const placed = instance('button-b', 'button', { overrides });
  return {
    placed,
    board: boardOf([
      component('icon-a'),
      path('a-path', 'icon-a'),
      target,
      path('b-path', 'icon-b'),
      component('button'),
      frame('content', 'button'),
      text('label', 'content'),
      instance('slot', 'icon-a', { parentId: 'button' }),
      instance('button-a', 'button'),
      placed,
    ]),
  };
}

function ids(board: ReturnType<typeof boardOf>, placed: ReturnType<typeof instance>): string[] {
  return resolveInstance(board, placed).objects.map(({ id }) => id);
}

describe('resolveInstance with a swapped slot', () => {
  it('expands only the swapped button instance with stable virtual addresses', () => {
    const { board, placed } = buttonBoard({ slot: { mainId: 'icon-b' } });
    const ordinary = instance('button-a', 'button');
    expect(ids(board, ordinary)).toContain('button-a/slot/a-path');
    expect(ids(board, ordinary)).not.toContain('button-a/slot/b-path');
    expect(ids(board, placed)).toContain('button-b/slot/b-path');
    expect(ids(board, placed)).not.toContain('button-b/slot/a-path');
    expect(ids(board, placed)).toContain('button-b/content');
    expect(ids(board, placed)).toContain('button-b/label');
  });

  it('keeps old deep overrides inactive and restores them when swapped back', () => {
    const records = {
      slot: { mainId: 'icon-b' },
      'slot/a-path': { isHidden: true },
      'slot/b-path': { isHidden: true },
    };
    const { board, placed } = buttonBoard(records);
    expect(ids(board, placed)).not.toContain('button-b/slot/b-path');
    const bVisible = instance('button-b', 'button', {
      overrides: {
        slot: { mainId: 'icon-b' },
        'slot/b-path': { isHidden: false },
        'slot/a-path': { isHidden: true },
      },
    });
    expect(ids(board, bVisible)).toContain('button-b/slot/b-path');
    const back = instance('button-b', 'button', {
      overrides: { 'slot/a-path': { isHidden: true } },
    });
    expect(ids(board, back)).not.toContain('button-b/slot/a-path');
    const restored = instance('button-b', 'button', {
      overrides: { 'slot/a-path': { isHidden: false } },
    });
    expect(ids(board, restored)).toContain('button-b/slot/a-path');
  });

  it('renders the stored main for a missing or retired swap target', () => {
    const plain = buttonBoard();
    const swapped = buttonBoard({ slot: { mainId: 'icon-b' } });
    expect(ids(swapped.board, swapped.placed)).toContain('button-b/slot/b-path');
    const expected = ids(plain.board, instance('button-b', 'button'));
    expect(
      ids(
        buttonBoard({ slot: { mainId: 'missing' } }).board,
        buttonBoard({ slot: { mainId: 'missing' } }).placed,
      ),
    ).toEqual(expected);
    const retired = buttonBoard(
      { slot: { mainId: 'icon-b' } },
      component('icon-b', { retired: true }),
    );
    expect(ids(retired.board, retired.placed)).toEqual(expected);
  });

  it('carries a nested variant by axis name and uses new-main presets and defaults', () => {
    const iconA = component('icon-a', {
      variantAxes: [{ name: 'State', values: ['Idle', 'Busy'] }],
    });
    const iconB = component('icon-b', {
      variantAxes: [{ name: 'State', values: ['Default', 'Active'] }],
      variantPresets: {
        'State=Default': { leaf: { isHidden: true } },
        'State=Active': { leaf: { fill: [1, 0, 0, 1] } },
      },
    });
    const slot = instance('slot', 'icon-a', { parentId: 'button', variant: { State: 'Busy' } });
    const root = instance('root', 'button', { overrides: { slot: { mainId: 'icon-b' } } });
    const board = boardOf([iconA, iconB, shape('leaf', 'icon-b'), component('button'), slot, root]);
    expect(ids(board, root)).not.toContain('root/slot/leaf');
    const active = instance('root', 'button', {
      overrides: { slot: { mainId: 'icon-b', variant: { State: 'Active' } } },
    });
    expect(
      resolveInstance(board, active).objects.find(({ id }) => id === 'root/slot/leaf'),
    ).toMatchObject({ fill: [1, 0, 0, 1] });
  });

  it('applies a swap two slots below the root', () => {
    const root = instance('root', 'card', {
      overrides: { 'button-slot/icon-slot': { mainId: 'icon-b' } },
    });
    const board = boardOf([
      component('icon-a'),
      path('a-path', 'icon-a'),
      component('icon-b'),
      path('b-path', 'icon-b'),
      component('button'),
      instance('icon-slot', 'icon-a', { parentId: 'button' }),
      component('card'),
      instance('button-slot', 'button', { parentId: 'card' }),
      root,
    ]);
    expect(ids(board, root)).toContain('root/button-slot/icon-slot/b-path');
    expect(ids(board, root)).not.toContain('root/button-slot/icon-slot/a-path');
  });
});
