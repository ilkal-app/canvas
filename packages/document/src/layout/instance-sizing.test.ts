import { describe, expect, it } from 'vitest';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { resizeObjectsCommand } from '../commands/resize-objects.js';
import { setAutoLayoutCommand } from '../commands/set-auto-layout.js';
import { setInstanceOverrideCommand } from '../commands/set-instance-override.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';

import { box, rect, ROW, storeWithComponents } from './__fixtures__/auto-layout-fixtures.js';

// An instance follows its main's content even when the main's own box does not
// change, since the instance's overrides can hide what set the main's size.

describe('an instance of a hugging main', () => {
  it('resizes when a child its overrides leave in the flow grows, though the main does not', () => {
    const store = storeWithComponents();
    store.transact(ADA, (transaction) => {
      transaction.setObject(box('tall', 'component-card', 'a0', 40, 40));
      transaction.setObject(box('short', 'component-card', 'a1', 30, 20));
    });
    applyCommand(store, setAutoLayoutCommand, { ids: ['component-card'], autoLayout: ROW });
    applyCommand(store, setInstanceOverrideCommand, {
      id: 'instance-card',
      path: 'tall',
      override: { isHidden: true },
    });
    // Only the short child is in the instance's flow: 20 high, padded 5 above and below.
    expect(rect(store, 'instance-card')[3]).toBe(30);
    const mainBefore = rect(store, 'component-card');
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'short', to: { width: 30, height: 30 } }],
    });
    // The tall child still sets the main's height; the instance follows the short one.
    expect(rect(store, 'component-card')).toEqual(mainBefore);
    expect(rect(store, 'instance-card')[3]).toBe(40);
  });
});
