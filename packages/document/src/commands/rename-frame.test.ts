import { describe, expect, it } from 'vitest';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { renameFrameCommand } from './rename-frame.js';

describe('renameFrame', () => {
  it('writes the name alone, as one undo step', () => {
    const store = createNestedFramesStore();
    const history = createHistory(store, ADA_ID);
    const before = store.read();
    const { result, changes } = applyCommand(store, renameFrameCommand, {
      id: 'frame-side',
      name: 'Ideas',
    });
    expect(result).toEqual({ isChanged: true });
    expectDiff(before, store.read(), changes, { updated: ['frame-side'] });
    expect(mustGet(store, 'frame-side')).toMatchObject({ name: 'Ideas', x: 800, y: 0 });
    expect(history.undo()).toBe(true);
    expect(mustGet(store, 'frame-side')).toMatchObject({ name: 'frame-side' });
  });

  it('writes nothing when the frame already has the name', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, renameFrameCommand, {
      id: 'frame-side',
      name: 'frame-side',
    });
    expect(result).toEqual({ isChanged: false });
    expectDiff(before, store.read(), changes, {});
  });

  it('refuses a missing object, an object that is not a frame and a name over 200 characters', () => {
    const store = createNestedFramesStore();
    const codes = (input: unknown) =>
      expectRejected(store, renameFrameCommand, input).map((error) => error.code);
    expect(codes({ id: 'gone', name: 'A' })).toEqual(['missing-object']);
    expect(codes({ id: 'rect-free', name: 'A' })).toEqual(['invalid-input']);
    expect(codes({ id: 'frame-side', name: 'x'.repeat(201) })).toEqual(['invalid-input']);
  });
});
