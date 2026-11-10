// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useElementHeight } from './use-element-height.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A `ResizeObserver` the test drives.
 *
 * @returns `resize(height)`, which reports a new content height, and the disconnect spy.
 */
function stubResizeObserver() {
  let report: ((entries: { contentRect: { height: number } }[]) => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: typeof report) {
        report = callback;
      }
      observe(): void {
        // The test reports sizes itself.
      }
      disconnect = disconnect;
    },
  );
  return {
    disconnect,
    resize: (height: number | undefined) => {
      act(() => {
        report?.(height === undefined ? [] : [{ contentRect: { height } }]);
      });
    },
  };
}

describe('useElementHeight', () => {
  it('follows the element, falling back while it measures nothing', () => {
    const observer = stubResizeObserver();
    const ref = { current: document.createElement('div') };
    const hook = renderHook(() => useElementHeight(ref, 480));
    expect(hook.result.current).toBe(480);
    observer.resize(300);
    expect(hook.result.current).toBe(300);
    observer.resize(0);
    expect(hook.result.current).toBe(480);
    observer.resize(undefined);
    expect(hook.result.current).toBe(480);
    hook.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the fallback without an element or an observer', () => {
    const ref = { current: null };
    expect(renderHook(() => useElementHeight(ref, 200)).result.current).toBe(200);
  });
});
