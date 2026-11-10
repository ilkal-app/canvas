import { describe, expect, it } from 'vitest';

import { buildChildIndex } from '../board/child-index.js';

import { boardOf, component, id, instance, path, shape } from './__fixtures__/component-board.js';
import { effectiveSlotMain, slotSwapIssue } from './effective-slot-main.js';
import { resolveInstance } from './resolve-instance.js';
import { presetKey } from './variants.js';

const slot = instance('slot', 'icon-a', { parentId: 'button' });

describe('effectiveSlotMain edges', () => {
  it('keeps the stored main when the record names it', () => {
    const board = boardOf([component('button'), component('icon-a'), slot]);
    expect(effectiveSlotMain(board, slot, { mainId: id('icon-a') }, [id('button')])).toBe(
      id('icon-a'),
    );
  });

  it('swaps to a target whose nested slots share a main, or name a missing one', () => {
    const board = boardOf([
      component('button'),
      component('icon-a'),
      slot,
      component('dot'),
      component('icon-b'),
      instance('left', 'dot', { parentId: 'icon-b' }),
      instance('right', 'dot', { parentId: 'icon-b' }),
      instance('lost', 'missing', { parentId: 'icon-b' }),
    ]);
    const children = buildChildIndex(board);
    expect(effectiveSlotMain(board, slot, { mainId: id('icon-b') }, [id('button')], children)).toBe(
      id('icon-b'),
    );
  });

  it('falls back for a target that holds a cycle of its own', () => {
    const board = boardOf([
      component('button'),
      component('icon-a'),
      slot,
      component('icon-b'),
      component('loop'),
      instance('into-loop', 'loop', { parentId: 'icon-b' }),
      instance('again', 'loop', { parentId: 'loop' }),
    ]);
    expect(effectiveSlotMain(board, slot, { mainId: id('icon-b') }, [id('button')])).toBe(
      id('icon-a'),
    );
  });

  it('falls back for a target with no room left under deep ancestors', () => {
    const board = boardOf([component('button'), component('icon-a'), slot, component('icon-b')]);
    const ancestors = ['m1', 'm2', 'm3', 'm4', 'm5'].map(id);
    expect(effectiveSlotMain(board, slot, { mainId: id('icon-b') }, ancestors)).toBe(id('icon-a'));
  });

  it('expands a swapped slot as the virtual instance of its effective main', () => {
    const board = boardOf([
      component('icon-a'),
      component('icon-b'),
      path('b-path', 'icon-b'),
      component('button'),
      slot,
    ]);
    const placed = instance('placed', 'button', { overrides: { slot: { mainId: 'icon-b' } } });
    const copy = resolveInstance(board, placed).objects.find(({ id }) => id === 'placed/slot');
    expect(copy).toMatchObject({ type: 'instance', mainId: 'icon-b' });
  });
});

describe('slotSwapIssue', () => {
  const board = boardOf([
    component('button'),
    component('icon-a'),
    slot,
    component('icon-b'),
    component('old', { retired: true }),
    shape('plain', null),
    component('wrapper'),
    instance('nested-button', 'button', { parentId: 'wrapper' }),
  ]);
  const ancestors = [id('button')];

  it('names why each unusable target cannot be swapped in', () => {
    expect(slotSwapIssue(board, id('missing'), ancestors)).toBe('missing-main');
    expect(slotSwapIssue(board, id('plain'), ancestors)).toBe('invalid-main');
    expect(slotSwapIssue(board, id('old'), ancestors)).toBe('retired-main');
    expect(slotSwapIssue(board, id('button'), ancestors)).toBe('instance-cycle');
    expect(slotSwapIssue(board, id('wrapper'), ancestors)).toBe('instance-cycle');
    expect(slotSwapIssue(board, id('icon-b'), ['m1', 'm2', 'm3', 'm4', 'm5'].map(id))).toBe(
      'instance-depth',
    );
  });

  it('finds nothing wrong with a live main that fits', () => {
    expect(slotSwapIssue(board, id('icon-b'), ancestors)).toBeUndefined();
  });

  it('treats reaching an excluded main as a cycle, never counting it toward depth', () => {
    const shared = boardOf([
      component('button'),
      component('icon-a'),
      slot,
      component('host'),
      component('pair'),
      instance('left', 'dot', { parentId: 'pair' }),
      instance('right', 'dot', { parentId: 'pair' }),
      component('dot'),
      instance('into-host', 'host', { parentId: 'dot' }),
    ]);
    const excluded = new Set([id('host')]);
    expect(slotSwapIssue(shared, id('pair'), ancestors, undefined, excluded)).toBe(
      'instance-cycle',
    );
    expect(slotSwapIssue(shared, id('host'), ancestors, undefined, excluded)).toBe(
      'instance-cycle',
    );
    // `dot` is reached twice and read once; nothing excluded is reached.
    expect(
      slotSwapIssue(shared, id('pair'), ancestors, undefined, new Set([id('icon-a')])),
    ).toBeUndefined();
    expect(slotSwapIssue(shared, id('pair'), ancestors)).toBeUndefined();
  });

  it('on a write, follows stored swaps and presets, and walks past a missing main', () => {
    const swaps = boardOf([
      component('button'),
      component('icon-a'),
      slot,
      component('via-record'),
      instance('carrier', 'icon-a', {
        parentId: 'via-record',
        overrides: { inner: { mainId: 'button' } },
      }),
      component('via-preset', {
        variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
        variantPresets: { [presetKey('state', 'hover')]: { inner: { mainId: 'button' } } },
      }),
      component('lost'),
      instance('to-nowhere', 'nowhere', { parentId: 'lost' }),
    ]);
    const none = new Set<ReturnType<typeof id>>();
    expect(slotSwapIssue(swaps, id('via-record'), ancestors, undefined, none)).toBe(
      'instance-cycle',
    );
    expect(slotSwapIssue(swaps, id('via-preset'), ancestors, undefined, none)).toBe(
      'instance-cycle',
    );
    expect(slotSwapIssue(swaps, id('lost'), ancestors, undefined, none)).toBeUndefined();
    // Reading follows only where a swap can expand, so it does not refuse these.
    expect(slotSwapIssue(swaps, id('via-record'), ancestors)).toBeUndefined();
  });
});
