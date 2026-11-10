// @vitest-environment jsdom
// Item 1: useOpeningCamera wires a mounted engine to OpeningCamera, only where the host
// asks for it, and never for a link to an object.
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { PageId } from '@canvas/schema';

import { createCameraSource } from '../editing/camera-source.js';
import type { BoardViewChange } from '../engine/board-view.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { OPENING_FIT_STORAGE_KEY, useOpeningCamera } from './opening-camera.js';
import { savePageCamera } from './page-cameras.js';

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

/** A storage in memory, standing in for `localStorage`. */
class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/**
 * An engine whose page holds some objects, its board feed and actions spied on.
 *
 * @param objects - How many objects the page holds.
 * @param hasPages - Whether it has pages.
 * @returns The engine and its spies.
 */
function fakeEngine(objects: number, hasPages = true) {
  const listeners = new Set<(change: BoardViewChange) => void>();
  const runCanvasAction = vi.fn();
  const engine = {
    ready: Promise.resolve(),
    ...(hasPages
      ? { pages: { current: () => 'page-1' as PageId, objectCount: () => objects } }
      : {}),
    camera: () => CAMERA,
    runCanvasAction,
    board: {
      subscribe: (listener: (change: BoardViewChange) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as MountedEngine;
  return { engine, runCanvasAction, listeners };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

describe('useOpeningCamera (item 1)', () => {
  it('fits a board as it opens, and leaves one empty once loaded alone', async () => {
    const { engine, runCanvasAction, listeners } = fakeEngine(0);
    const camera = createCameraSource();
    const { unmount } = renderHook(() => {
      useOpeningCamera(engine, camera, true);
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    for (const listener of listeners) listener({ kind: 'document', changes: {} as never });
    expect(runCanvasAction).not.toHaveBeenCalled();
    unmount();
    expect(listeners.size).toBe(0);
    const loaded = fakeEngine(4);
    renderHook(() => {
      useOpeningCamera(loaded.engine, camera, true);
    });
    await vi.waitFor(() => {
      expect(loaded.runCanvasAction).toHaveBeenCalledWith({
        type: 'navigate',
        command: 'zoomToFit',
      });
    });
  });

  it('waits for the connection’s first sync, then fits what it brought', async () => {
    let objects = 0;
    let state: 'connecting' | 'connected' = 'connecting';
    const statusListeners = new Set<() => void>();
    const connection = {
      status: () => ({ state }) as never,
      subscribe: (listener: () => void) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    };
    const { engine, runCanvasAction } = fakeEngine(0);
    (engine.pages as unknown as { objectCount: () => number }).objectCount = () => objects;
    const { unmount } = renderHook(() => {
      useOpeningCamera(engine, createCameraSource(), true, connection);
    });
    await Promise.resolve();
    objects = 2;
    for (const listener of [...statusListeners]) listener();
    expect(runCanvasAction).not.toHaveBeenCalled();
    state = 'connected';
    for (const listener of [...statusListeners]) listener();
    await vi.waitFor(() => {
      expect(runCanvasAction).toHaveBeenCalledTimes(1);
    });
    expect(statusListeners.size).toBe(0);
    unmount();
    // A connection already synced: no wait.
    const synced = fakeEngine(3);
    renderHook(() => {
      useOpeningCamera(synced.engine, createCameraSource(), true, connection);
    });
    await vi.waitFor(() => {
      expect(synced.runCanvasAction).toHaveBeenCalledTimes(1);
    });
  });

  it('follows a connection swapped under the engine, never opening again (a session ended)', async () => {
    const live = {
      status: () => ({ state: 'connected' }) as never,
      subscribe: () => () => undefined,
    };
    const ended = {
      status: () => ({ state: 'unauthorized' }) as never,
      subscribe: () => () => undefined,
    };
    const { engine, runCanvasAction } = fakeEngine(3);
    const camera = createCameraSource();
    const { rerender } = renderHook(
      ({ connection }: { connection: typeof live }) => {
        useOpeningCamera(engine, camera, true, connection);
      },
      { initialProps: { connection: live } },
    );
    await vi.waitFor(() => {
      expect(runCanvasAction).toHaveBeenCalledTimes(1);
    });
    rerender({ connection: ended });
    await Promise.resolve();
    await Promise.resolve();
    expect(runCanvasAction).toHaveBeenCalledTimes(1);
  });

  it('waits for a connection swapped in while the first still connects', async () => {
    let state: 'connecting' | 'connected' = 'connecting';
    const listeners = new Set<() => void>();
    const first = {
      status: () => ({ state: 'connecting' }) as never,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const second = {
      status: () => ({ state }) as never,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const { engine, runCanvasAction } = fakeEngine(2);
    const camera = createCameraSource();
    const { rerender } = renderHook(
      ({ connection }: { connection: typeof first }) => {
        useOpeningCamera(engine, camera, true, connection);
      },
      { initialProps: { connection: first } },
    );
    rerender({ connection: second });
    expect(listeners.size).toBe(1);
    expect(runCanvasAction).not.toHaveBeenCalled();
    state = 'connected';
    for (const listener of [...listeners]) listener();
    await vi.waitFor(() => {
      expect(runCanvasAction).toHaveBeenCalledTimes(1);
    });
    expect(listeners.size).toBe(0);
  });

  it('does not fit on a device whose opening fit is off (the scenario specs)', async () => {
    localStorage.setItem(OPENING_FIT_STORAGE_KEY, 'off');
    const { engine, runCanvasAction } = fakeEngine(4);
    renderHook(() => {
      useOpeningCamera(engine, createCameraSource(), true);
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runCanvasAction).not.toHaveBeenCalled();
    localStorage.setItem(OPENING_FIT_STORAGE_KEY, 'on');
    const on = fakeEngine(4);
    renderHook(() => {
      useOpeningCamera(on.engine, createCameraSource(), true);
    });
    await vi.waitFor(() => {
      expect(on.runCanvasAction).toHaveBeenCalledTimes(1);
    });
  });

  it('stops waiting for the connection when unmounted', () => {
    const statusListeners = new Set<() => void>();
    const connection = {
      status: () => ({ state: 'connecting' }) as never,
      subscribe: (listener: () => void) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    };
    const { engine } = fakeEngine(1);
    const { unmount } = renderHook(() => {
      useOpeningCamera(engine, createCameraSource(), true, connection);
    });
    expect(statusListeners.size).toBe(1);
    unmount();
    expect(statusListeners.size).toBe(0);
  });

  it('fits over a stored camera', async () => {
    savePageCamera(location.pathname, 'page-1' as PageId, { ...CAMERA, x: 30, zoom: 2 });
    const { engine, runCanvasAction } = fakeEngine(4);
    renderHook(() => {
      useOpeningCamera(engine, createCameraSource(), true);
    });
    await vi.waitFor(() => {
      expect(runCanvasAction).toHaveBeenCalledWith({ type: 'navigate', command: 'zoomToFit' });
    });
  });

  it('does nothing when off, without pages, or for a link to an object', async () => {
    const off = fakeEngine(4);
    renderHook(() => {
      useOpeningCamera(off.engine, createCameraSource(), false);
    });
    const noPages = fakeEngine(4, false);
    renderHook(() => {
      useOpeningCamera(noPages.engine, createCameraSource(), true);
    });
    renderHook(() => {
      useOpeningCamera(undefined, createCameraSource(), true);
    });
    history.replaceState(null, '', '/?object=sticky-1');
    const linked = fakeEngine(4);
    renderHook(() => {
      useOpeningCamera(linked.engine, createCameraSource(), true);
    });
    await Promise.resolve();
    await Promise.resolve();
    for (const fake of [off, noPages, linked]) expect(fake.runCanvasAction).not.toHaveBeenCalled();
  });
});
