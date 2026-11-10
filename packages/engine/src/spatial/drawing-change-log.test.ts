import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { DrawingChangeLog } from './drawing-change-log.js';

const id = (name: string): ObjectId => name as ObjectId;

describe('DrawingChangeLog', () => {
  it('lists the objects changed after a revision, and nothing at the latest', () => {
    const log = new DrawingChangeLog();
    expect(log.revision).toBe(0);
    log.note(id('a'));
    log.note(id('b'));
    expect(log.revision).toBe(2);
    expect(log.since(0)).toEqual(['a', 'b']);
    expect(log.since(1)).toEqual(['b']);
    expect(log.since(2)).toEqual([]);
  });

  it('cannot say what changed across an unknown change', () => {
    const log = new DrawingChangeLog();
    log.note(id('a'));
    log.noteUnknown();
    log.note(id('b'));
    expect(log.since(0)).toBeUndefined();
    expect(log.since(2)).toEqual(['b']);
  });

  it('forgets the oldest changes, and says so to a reader behind them', () => {
    const log = new DrawingChangeLog();
    for (let index = 0; index < 8192; index += 1) log.note(id(`o${String(index)}`));
    expect(log.since(0)).toBeUndefined();
    expect(log.since(8190)).toEqual(['o8190', 'o8191']);
    expect(log.since(4096)?.length).toBe(4096);
  });
});
