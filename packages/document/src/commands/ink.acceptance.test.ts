// Independent acceptance of the stored token, real command/undo and peer exchange.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createHistory } from '../history/undo-manager.js';
import { ADA, createSyncedPair, exchange } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

const inkInput = {
  changes: [{ id: 'shape-box', style: { stroke: { color: 'ink', width: 2 } } }],
} as unknown as z.input<typeof setStyleCommand.input>;

describe('stored ink acceptance', () => {
  it('sends the token unchanged to another client and restores the earlier stroke in one undo', () => {
    const [a, b] = createSyncedPair();
    const before = mustGet(a, 'shape-box');
    const history = createHistory(a, ADA.principalId);
    applyCommand(a, setStyleCommand, inkInput);
    exchange(a, b);
    expect(mustGet(a, 'shape-box')).toMatchObject({ stroke: { color: 'ink', width: 2 } });
    expect(mustGet(b, 'shape-box')).toEqual(mustGet(a, 'shape-box'));
    expect(history.undo()).toBe(true);
    exchange(a, b);
    expect(mustGet(b, 'shape-box')).toEqual(before);
    expect(history.redo()).toBe(true);
    exchange(a, b);
    expect(mustGet(b, 'shape-box')).toMatchObject({ stroke: { color: 'ink' } });
    history.destroy();
    a.destroy();
    b.destroy();
  });
});
