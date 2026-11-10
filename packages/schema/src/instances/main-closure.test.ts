import { describe, expect, it } from 'vitest';

import type { Board } from '../board/board.js';
import { buildChildIndex } from '../board/child-index.js';

import { boardOf, component, frame, id, instance, shape } from './__fixtures__/component-board.js';
import { mainClosure, type DefinitionReader } from './main-closure.js';

function readerOf(board: Board): DefinitionReader {
  const children = buildChildIndex(board);
  return { get: (key) => board.objects.get(key), childrenOf: (key) => children.get(key) ?? [] };
}

describe('mainClosure', () => {
  it('follows content, stored mains, records and presets, and names missing mains', () => {
    const board = boardOf([
      component('button', {
        variantPresets: { 'state=active': { slot: { mainId: 'icon-c' } } },
      }),
      frame('row', 'button'),
      instance('slot', 'icon-a', { parentId: 'row', overrides: { deep: { mainId: 'gone' } } }),
      component('icon-a'),
      shape('a-mark', 'icon-a'),
      component('icon-b'),
      shape('b-mark', 'icon-b'),
      component('icon-c'),
      shape('c-mark', 'icon-c'),
      shape('elsewhere', null),
      instance('placed', 'button', { overrides: { slot: { mainId: 'icon-b' } } }),
    ]);
    expect([...mainClosure(readerOf(board), [id('button')])]).toEqual([
      'button',
      'icon-c',
      'row',
      'c-mark',
      'slot',
      'icon-a',
      'gone',
      'a-mark',
    ]);
    const placed = mainClosure(readerOf(board), [id('placed')]);
    expect(placed.has(id('icon-b'))).toBe(true);
    expect(placed.has(id('b-mark'))).toBe(true);
    expect(placed.has(id('elsewhere'))).toBe(false);
  });

  it('ends at a reference cycle stored on the board', () => {
    const board = boardOf([
      component('a'),
      instance('in-a', 'b', { parentId: 'a' }),
      component('b'),
      instance('in-b', 'a', { parentId: 'b', overrides: { x: { mainId: 'b' } } }),
    ]);
    expect(mainClosure(readerOf(board), [id('a'), id('a')]).size).toBe(4);
  });
});
