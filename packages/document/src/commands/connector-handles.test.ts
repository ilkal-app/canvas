import { afterEach, describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';
import { STYLE_FIELDS_BY_TYPE } from './style-fields.js';

const stores: YjsDocumentStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.destroy();
});

/**
 * The fixture board, whose connector routes automatically.
 *
 * @returns The seeded store.
 */
function seeded(): YjsDocumentStore {
  const store = createFixtureStore();
  stores.push(store);
  return store;
}

describe('a connector’s route handles via setStyle', () => {
  it('takes elbowMiddle and curvePoint on a connector only', () => {
    expect(STYLE_FIELDS_BY_TYPE.connector).toEqual(
      expect.arrayContaining(['elbowMiddle', 'curvePoint']),
    );
    expect(STYLE_FIELDS_BY_TYPE.line).not.toContain('elbowMiddle');
    expect(STYLE_FIELDS_BY_TYPE.shape).not.toContain('curvePoint');
  });

  it('writes a moved handle as one undo step', () => {
    const store = seeded();
    const before = store.get('connector-flow' as never);
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'connector-flow', style: { elbowMiddle: 0.25 } }],
    });
    expect(store.get('connector-flow' as never)).toHaveProperty('elbowMiddle', 0.25);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'connector-flow', style: { curvePoint: { x: 0.5, y: -0.3 } } }],
    });
    expect(store.get('connector-flow' as never)).toHaveProperty('curvePoint', { x: 0.5, y: -0.3 });
    expect(history.undo()).toBe(true);
    expect(store.get('connector-flow' as never)).not.toHaveProperty('curvePoint');
    expect(history.undo()).toBe(true);
    expect(store.get('connector-flow' as never)).toEqual(before);
    history.destroy();
  });

  it('removes a handle with an explicit undefined, back to automatic', () => {
    const store = seeded();
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'connector-flow', style: { elbowMiddle: 0.25, curvePoint: { x: 0, y: 1 } } }],
    });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'connector-flow', style: { elbowMiddle: undefined, curvePoint: undefined } }],
    });
    const connector = store.get('connector-flow' as never);
    expect(connector).not.toHaveProperty('elbowMiddle');
    expect(connector).not.toHaveProperty('curvePoint');
  });

  it.each([
    { elbowMiddle: -0.01 },
    { elbowMiddle: 1.01 },
    { elbowMiddle: Number.NaN },
    { curvePoint: { x: 0, y: 11 } },
    { curvePoint: { x: 0 } },
  ])('refuses %o without changing the document', (style) => {
    const store = seeded();
    expectRejected(store, setStyleCommand, { changes: [{ id: 'connector-flow', style }] });
    expect(store.get('connector-flow' as never)).not.toHaveProperty('elbowMiddle');
    expect(store.get('connector-flow' as never)).not.toHaveProperty('curvePoint');
  });
});
