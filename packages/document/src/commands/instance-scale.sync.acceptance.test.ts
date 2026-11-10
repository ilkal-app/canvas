// Acceptance: scale and an independent child override survive offline exchange.
import { describe, expect, it } from 'vitest';

import {
  BOB_ENVIRONMENT,
  expectValidAndConverged,
  ORDERS,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, exchange } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createComponentPair,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand } from './__fixtures__/component-fixtures.js';
import { resizeObjectsCommand } from './resize-objects.js';

describe.each(ORDERS)('instance scale sync ($name)', ({ adaClientId, bobClientId }) => {
  it('keeps Ada’s scale and Bob’s child fill override after exchange', () => {
    let boxId = '';
    const [ada, bob] = createComponentPair(adaClientId, bobClientId, (store) => {
      const main = seedMainWithChildren(store);
      boxId = main.boxId;
      placeInstance(store, main.mainId, { instanceId: 'copy', x: 1000, y: 0 });
    });
    applyCommand(ada, resizeObjectsCommand, {
      resizes: [{ id: 'copy', scale: 0.5 }],
    });
    applyCommand(
      bob,
      mustFindCommand('setInstanceOverride'),
      {
        id: 'copy',
        path: boxId,
        override: { fill: [0, 1, 0, 1] },
      },
      BOB,
      BOB_ENVIRONMENT,
    );
    exchange(ada, bob);
    expectValidAndConverged(ada, bob);
    for (const store of [ada, bob]) {
      expect(mustGet(store, 'copy')).toMatchObject({
        scale: 0.5,
        width: 200,
        height: 150,
        overrides: { [boxId]: { fill: [0, 1, 0, 1] } },
      });
    }
  });
});
