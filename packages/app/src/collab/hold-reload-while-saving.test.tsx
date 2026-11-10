// @vitest-environment jsdom
// The reload hold: a `beforeunload` listener only while the board cache has writes
// pending, and no new cache work once the page is being hidden. In Chrome:
// tooling/scenario/specs/app/reload-while-saving.spec.ts.
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheWriteTracker, type BoardCacheWrites } from '@canvas/collab';

import { holdReloadWhileSaving, useHoldReloadWhileSaving } from './hold-reload-while-saving.js';

/**
 * A write the test completes.
 *
 * @returns The write and how to complete it.
 */
function deferredWrite(): { readonly write: Promise<void>; readonly complete: () => void } {
  let complete!: () => void;
  const write = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { write, complete };
}

/**
 * Fires a cancelable `beforeunload` at the window, as a reload does.
 *
 * @returns Whether a listener asked to confirm leaving.
 */
function fireBeforeUnload(): { readonly isHeld: boolean } {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return { isHeld: event.defaultPrevented };
}

/**
 * Sets the document's visibility and fires `visibilitychange`.
 *
 * @param state - The new visibility.
 */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('holdReloadWhileSaving', () => {
  it('lets an idle page reload without a prompt', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const stop = holdReloadWhileSaving(new CacheWriteTracker());
    expect(fireBeforeUnload().isHeld).toBe(false);
    expect(add.mock.calls.map(([type]) => type)).not.toContain('beforeunload');
    stop();
  });

  it('holds a reload while a write is pending, and lets go once it commits', async () => {
    const writes = new CacheWriteTracker();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const stop = holdReloadWhileSaving(writes);
    const { write, complete } = deferredWrite();
    void writes.track(write);
    expect(fireBeforeUnload().isHeld).toBe(true);
    complete();
    await writes.settled();
    expect(fireBeforeUnload().isHeld).toBe(false);
    const installs = add.mock.calls.filter(([type]) => type === 'beforeunload');
    const removals = remove.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(installs).toHaveLength(1);
    expect(removals).toHaveLength(1);
    expect(removals[0]?.[1]).toBe(installs[0]?.[1]);
    stop();
  });

  it('sets a truthy returnValue too, which older Chrome reads instead of preventDefault', () => {
    const writes = new CacheWriteTracker();
    const add = vi.spyOn(window, 'addEventListener');
    const stop = holdReloadWhileSaving(writes);
    void writes.track(deferredWrite().write);
    const listener = add.mock.calls.find(([type]) => type === 'beforeunload')?.[1];
    const event = { preventDefault: vi.fn(), returnValue: '' as unknown };
    (listener as (event: unknown) => void)(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe(true);
    stop();
  });

  it('holds from the first of overlapping writes until the last, installing once', async () => {
    const writes = new CacheWriteTracker();
    const add = vi.spyOn(window, 'addEventListener');
    const stop = holdReloadWhileSaving(writes);
    const first = deferredWrite();
    const second = deferredWrite();
    void writes.track(first.write);
    void writes.track(second.write);
    first.complete();
    await first.write;
    await Promise.resolve();
    expect(fireBeforeUnload().isHeld).toBe(true);
    second.complete();
    await writes.settled();
    expect(fireBeforeUnload().isHeld).toBe(false);
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
    stop();
  });

  it('holds at once for a cache already busy, and stops holding when stopped', () => {
    const writes = new CacheWriteTracker();
    void writes.track(deferredWrite().write);
    const stop = holdReloadWhileSaving(writes);
    expect(fireBeforeUnload().isHeld).toBe(true);
    stop();
    expect(fireBeforeUnload().isHeld).toBe(false);
  });

  it('holds new cache work while the page is hidden or hiding, and releases it when shown', () => {
    const writes = new CacheWriteTracker();
    const holdNewWork = vi.spyOn(writes, 'holdNewWork');
    const stop = holdReloadWhileSaving(writes);
    setVisibility('hidden');
    expect(writes.isNewWorkHeld).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    expect(holdNewWork).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(writes.isNewWorkHeld).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(writes.isNewWorkHeld).toBe(true);
    window.dispatchEvent(new Event('pageshow'));
    expect(writes.isNewWorkHeld).toBe(false);
    setVisibility('hidden');
    stop();
    expect(writes.isNewWorkHeld).toBe(false);
    setVisibility('visible');
    setVisibility('hidden');
    expect(writes.isNewWorkHeld).toBe(false);
  });
});

describe('useHoldReloadWhileSaving', () => {
  /**
   * Mounts the hook.
   *
   * @param props - The writes to follow.
   * @param props.writes - The cache's pending writes, if any.
   * @returns Nothing visible.
   */
  function Holder({ writes }: { readonly writes: BoardCacheWrites | undefined }): ReactElement {
    useHoldReloadWhileSaving(writes);
    return <span />;
  }

  it('holds from mount to unmount, and does nothing without a cache', () => {
    const writes = new CacheWriteTracker();
    void writes.track(deferredWrite().write);
    const view = render(<Holder writes={undefined} />);
    expect(fireBeforeUnload().isHeld).toBe(false);
    view.rerender(<Holder writes={writes} />);
    expect(fireBeforeUnload().isHeld).toBe(true);
    view.unmount();
    expect(fireBeforeUnload().isHeld).toBe(false);
  });
});
