// (layer opacity): a descendant override changes virtual style only.
import { describe, expect, it } from 'vitest';

import { boardOf, component, id, instance, shape } from './__fixtures__/component-board.js';
import { resolveInstance } from './resolve-instance.js';

const main = component('main');
const child = shape('child', 'main', { opacity: 0.8 });

function resolved(opacity: unknown) {
  const placement = instance('inst', 'main', { overrides: { child: { opacity } } });
  const board = boardOf([main, child, placement]);
  return resolveInstance(board, placement).objects.find((object) => object.id === id('inst/child'));
}

describe('instance layer opacity override', () => {
  it('replaces descendant opacity without changing the main child', () => {
    expect(resolved(0.25)).toMatchObject({ opacity: 0.25 });
    expect(child).toMatchObject({ opacity: 0.8 });
  });

  it('ignores an invalid override instead of exposing refused opacity', () => {
    expect(resolved(2)).toMatchObject({ opacity: 0.8 });
  });
});
