// The fast single-child resolver draws a main's hidden child that a record shows
// exactly as the full resolver does: shown, without the main's stored isHidden.
import { describe, expect, it } from 'vitest';

import type { InstanceObject } from '../objects/instance-object.js';

import { boardOf, component, id, instance, shape } from './__fixtures__/component-board.js';
import { resolve } from './__fixtures__/resolved-board.js';
import { resolveInstanceChild } from './resolve-instance-child.js';

describe('resolveInstanceChild and stored visibility', () => {
  it('shows a hidden main child a record shows, as resolveInstance does', () => {
    const board = boardOf([
      component('main'),
      shape('child', 'main', { isHidden: true }),
      instance('inst', 'main', { overrides: { child: { isHidden: false } } }),
    ]);
    const fast = resolveInstanceChild(
      board,
      board.objects.get(id('inst')) as InstanceObject,
      id('child'),
    );
    const full = resolve(board).objects.find((object) => object.id === 'inst/child');
    expect(fast).toEqual({ kind: 'shown', object: full });
    expect(full).not.toHaveProperty('isHidden');
  });

  it('reports a hidden main child no record shows as hidden', () => {
    const board = boardOf([
      component('main'),
      shape('child', 'main', { isHidden: true }),
      instance('inst', 'main'),
    ]);
    const fast = resolveInstanceChild(
      board,
      board.objects.get(id('inst')) as InstanceObject,
      id('child'),
    );
    expect(fast).toEqual({ kind: 'hidden' });
  });
});
