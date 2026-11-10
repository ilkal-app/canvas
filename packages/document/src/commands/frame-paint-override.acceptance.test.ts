import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newFrame,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import { mustFindCommand, overridesOf } from './__fixtures__/component-fixtures.js';

const RED = [1, 0, 0, 1] as const;

describe('frame paint command', () => {
  it('stores both frame paint fields and restores the prior record with undo', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    createChild(store, newFrame('paint-frame', mainId, { x: 0, y: 0, width: 40, height: 40 }));
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'paint-inst' });
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: 'paint-frame',
      override: { fill: RED, strokeColor: { token: 'surface_sheet' } },
    });
    expect(overridesOf(store, instanceId)).toEqual({
      'paint-frame': { fill: RED, strokeColor: { token: 'surface_sheet' } },
    });
    expect(history.undo()).toBe(true);
    expect(overridesOf(store, instanceId)).toEqual({});
    history.destroy();
    store.destroy();
  });

  it('still refuses an unsupported frame field without claiming paint is impossible', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    createChild(store, newFrame('paint-frame', mainId, { x: 0, y: 0, width: 40, height: 40 }));
    const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'paint-inst' });
    const errors = expectRejected(store, mustFindCommand('setInstanceOverride'), {
      id: instanceId,
      path: 'paint-frame',
      override: { color: RED },
    });
    expect(errors.map((error) => error.code)).toEqual(['invalid-override']);
    expect(errors[0]?.message).toMatch(/frame child takes/);
    expect(errors[0]?.message).toContain('fill');
    expect(errors[0]?.message).toContain('strokeColor');
    expect(errors[0]?.message).not.toMatch(/cannot override a frame's background or stroke/);
    store.destroy();
  });
});
