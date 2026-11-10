import { describe, expect, it } from 'vitest';

import {
  VIEW_ONLY_NOTICE_STORAGE_PREFIX,
  ViewOnlyNoticeMemory,
  type NoticeStorage,
} from './view-only-notice-memory.js';

/**
 * A storage over a map.
 *
 * @param items - The map it reads and writes.
 * @returns The storage.
 */
function mapStorage(items: Map<string, string>): NoticeStorage {
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** A storage the browser blocks: every call throws. */
const BLOCKED: NoticeStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('ViewOnlyNoticeMemory', () => {
  it('remembers per board, in the tab’s storage, so another page of the session knows', () => {
    const items = new Map<string, string>();
    const memory = new ViewOnlyNoticeMemory(() => mapStorage(items));
    expect(memory.hasShown('board-a')).toBe(false);
    memory.remember('board-a');
    expect(memory.hasShown('board-a')).toBe(true);
    expect(memory.hasShown('board-b')).toBe(false);
    expect([...items.keys()]).toEqual([`${VIEW_ONLY_NOTICE_STORAGE_PREFIX}board-a`]);
    expect(new ViewOnlyNoticeMemory(() => mapStorage(items)).hasShown('board-a')).toBe(true);
  });

  it('remembers for the page where storage is blocked or missing', () => {
    for (const storage of [BLOCKED, undefined]) {
      const memory = new ViewOnlyNoticeMemory(() => storage);
      expect(memory.hasShown('board-a')).toBe(false);
      memory.remember('board-a');
      expect(memory.hasShown('board-a')).toBe(true);
    }
  });
});
