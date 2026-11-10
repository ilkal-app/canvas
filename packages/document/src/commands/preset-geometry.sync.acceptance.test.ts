// Acceptance
import { describe, expect, it } from 'vitest';

import { validateBoard } from '@canvas/schema';

import { BOB_ENVIRONMENT } from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, exchange } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import {
  createComponentPair,
  placeInstance,
  seedLeafMain,
} from './__fixtures__/component-boards.js';
import { fieldOf, mustFindCommand } from './__fixtures__/component-fixtures.js';

describe.each([
  [1, 2],
  [2, 1],
])('root size and variant switch sync (%i, %i)', (adaId, bobId) => {
  it('converges when one client edits root size while the other switches the instance', () => {
    const [ada, bob] = createComponentPair(adaId, bobId, (store) => {
      seedLeafMain(store, 'main', { x: 0, y: 0 });
      applyCommand(store, mustFindCommand('setVariantAxes'), {
        componentId: 'main',
        axes: [{ name: 'Size', values: ['base', 'lg'] }],
      });
      placeInstance(store, 'main', { instanceId: 'copy', variant: { Size: 'base' } });
    });
    applyCommand(ada, mustFindCommand('setVariantPreset'), {
      componentId: 'main',
      axis: 'Size',
      value: 'lg',
      path: 'main',
      override: { width: 200, height: 180 },
    });
    applyCommand(
      bob,
      mustFindCommand('setInstanceVariant'),
      { id: 'copy', variant: { Size: 'lg' } },
      BOB,
      BOB_ENVIRONMENT,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(validateBoard(ada.read())).toEqual([]);
    expect(validateBoard(bob.read())).toEqual([]);
    expect(fieldOf(ada, 'copy', 'variant')).toEqual({ Size: 'lg' });
    expect(fieldOf(ada, 'copy', 'width')).toBe(200);
    expect(fieldOf(ada, 'copy', 'height')).toBe(180);
  });
});
