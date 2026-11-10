import { expect, it, vi } from 'vitest';

import { earlierLayoutBoard, holdsObject } from './__fixtures__/earlier-layout-board.js';
import type { EarlierLayoutBoard } from './document-cache.js';
import { LayoutCarryOver } from './layout-carry-over.js';
import { layoutStepKey } from './layout-converters.js';

function fixture() {
  const { relay, offline } = earlierLayoutBoard();
  const original: EarlierLayoutBoard = {
    source: 'retained-original',
    layoutVersion: 2,
    board: { snapshot: undefined, updates: [offline] },
    updateKeys: [1],
    snapshotVersion: undefined,
    isPreLayoutCache: false,
    shouldRecover: true,
  };
  const find = vi.fn(() => Promise.resolve([original]));
  const remove = vi.fn(() => Promise.resolve());
  const storeDurably = vi.fn<(update: Uint8Array) => Promise<void>>().mockResolvedValue(undefined);
  const onError = vi.fn();
  return {
    relay,
    offline,
    original,
    find,
    remove,
    storeDurably,
    onError,
    options: {
      store: relay,
      boardId: 'b',
      storeDurably,
      onError,
      earlierLayouts: { writerLayoutVersion: 3, find, delete: remove },
      converters: new Map([[layoutStepKey(2, 3), (bytes: Uint8Array) => bytes]]),
    },
  };
}

it.each(['conversion', 'storage'] as const)(
  'retains original recovery records after %s fails without applying them',
  async (failure) => {
    const f = fixture();
    const error = new Error(failure);
    if (failure === 'conversion')
      f.options.converters.set(layoutStepKey(2, 3), () => {
        throw error;
      });
    else f.storeDurably.mockRejectedValue(error);
    const carry = new LayoutCarryOver(f.options);
    await carry.run(true);
    expect(f.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(holdsObject(f.relay, 'offline')).toBe(false);
    expect(carry.stranded).toEqual([expect.objectContaining({ unsentChangeCount: 1 })]);
    const exported = carry.stranded[0]?.exportSource;
    expect(exported).toBeDefined();
    expect(await exported?.()).toEqual(f.original);
    await carry.dismiss(f.original.source);
    expect(carry.stranded).toHaveLength(1);
    expect(f.remove).not.toHaveBeenCalled();
    expect((await f.find())[0]?.board.updates).toEqual([f.offline]);
    carry.destroy();
    f.relay.destroy();
  },
);

it('exports newly retained manual bytes and falls back to the captured copy if the source disappears', async () => {
  const f = fixture();
  const manual = { ...f.original, replayPolicy: 'manual' as const };
  f.find.mockResolvedValue([manual]);
  const carry = new LayoutCarryOver(f.options);
  await carry.run(true);
  const exportSource = carry.stranded[0]?.exportSource;
  if (exportSource === undefined) throw new Error('Missing manual export.');
  const latest = { ...manual, board: { ...manual.board, updates: [f.offline, f.offline] } };
  f.find.mockResolvedValue([latest]);
  expect(await exportSource()).toEqual(latest);
  f.find.mockResolvedValue([]);
  expect(await exportSource()).toEqual(manual);
  await carry.dismiss(manual.source);
  expect(carry.stranded).toHaveLength(1);
  expect(f.remove).not.toHaveBeenCalled();
  expect(f.storeDurably).not.toHaveBeenCalled();
  expect(holdsObject(f.relay, 'offline')).toBe(false);
  carry.destroy();
  f.relay.destroy();
});
