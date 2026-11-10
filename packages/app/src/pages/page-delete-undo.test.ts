import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Page, PageId } from '@canvas/schema';

import { undoWhileTopmost } from './page-delete-undo.js';
import type { PageNavigation } from './page-navigator.js';

/**
 * A page navigation without `subscribeEdits`, whose pages a test changes by hand.
 *
 * @returns The navigation, a way to rename its page, and whether anyone listens.
 */
function plainNavigation() {
  let pages: readonly Page[] = [{ id: 'page-1' as PageId, name: 'Page 1', order: 'a0' }];
  const listeners = new Set<() => void>();
  const navigation: PageNavigation = {
    pages: () => pages,
    current: () => 'page-1' as PageId,
    objectCount: () => 0,
    show: () => undefined,
    step: () => undefined,
    run: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    navigation,
    rename: (name: string) => {
      pages = pages.map((page) => ({ ...page, name }));
      for (const listener of listeners) listener();
    },
    touch: () => {
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('undoWhileTopmost without subscribeEdits', () => {
  it('runs the undo until the pages change, then tells onLater once and stops listening', () => {
    const { navigation, rename, touch, listeners } = plainNavigation();
    const onLater = vi.fn();
    const undo = vi.fn();
    const run = undoWhileTopmost(navigation, onLater);
    // A switch or any announcement that leaves the pages as they were keeps Undo.
    touch();
    expect(onLater).not.toHaveBeenCalled();
    rename('Plan');
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    run(undo);
    expect(undo).not.toHaveBeenCalled();
  });

  it('stops listening once the notice has had its time', () => {
    vi.useFakeTimers();
    const { navigation, listeners } = plainNavigation();
    const run = undoWhileTopmost(navigation, vi.fn());
    expect(listeners.size).toBe(1);
    vi.runAllTimers();
    expect(listeners.size).toBe(0);
    const undo = vi.fn();
    run(undo);
    expect(undo).not.toHaveBeenCalled();
  });
});
