// Item 9, written before the code. CONTRACT: connectors remain root objects even when both ends lie over a section. Deliberately not asserted: route geometry.
import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { connectorToolContext } from './__fixtures__/connector-tool-context.js';
import { ConnectorMode } from './connector-mode.js';

it('keeps a connector across the existing frame at the root', () => {
  const { store, context } = connectorToolContext();
  const mode = new ConnectorMode(context);
  for (const [kind, x, y] of [
    ['pointerDown', 500, 100],
    ['pointerMove', 600, 150],
    ['pointerUp', 600, 150],
  ] as const) {
    mode.onPointer({
      kind,
      screen: { x, y },
      world: { x, y },
      zoom: 1,
      isShiftPressed: false,
      isModPressed: false,
    });
  }
  expect(store.get('new-1' as ObjectId)).toMatchObject({
    type: 'connector',
    parentId: null,
    x: 0,
    y: 0,
  });
});
