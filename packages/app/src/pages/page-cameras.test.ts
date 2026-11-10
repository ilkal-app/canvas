import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { Page, PageId } from '@canvas/schema';

import { keepPageCameras, PageCameras } from './page-cameras.js';
import type { PageNavigation } from './page-navigator.js';

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

/**
 * Pages whose shown page a test sets.
 *
 * @returns The pages and their switch.
 */
function fakePages(): { pages: PageNavigation; show: (pageId: string) => void } {
  let current = 'page-1' as PageId;
  const listeners = new Set<() => void>();
  const pages: PageNavigation = {
    pages: () => [] as Page[],
    current: () => current,
    objectCount: () => 0,
    show: (pageId) => {
      current = pageId;
      for (const listener of listeners) listener();
    },
    step: () => undefined,
    run: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    pages,
    show: (pageId) => {
      pages.show(pageId as PageId);
    },
  };
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PageCameras', () => {
  it('keeps each page camera, and fits a page never seen', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const { pages, show } = fakePages();
    let camera = CAMERA;
    const fitContent = vi.fn();
    const cameras = new PageCameras(
      pages,
      {
        camera: () => camera,
        setCamera: (next) => {
          camera = next;
        },
        fitContent,
      },
      'board',
    );
    camera = { ...camera, x: 40, zoom: 2 };
    show('p2');
    expect(fitContent).toHaveBeenCalledTimes(1);
    camera = { ...camera, x: -5, zoom: 0.5 };
    show('page-1');
    expect(camera).toMatchObject({ x: 40, zoom: 2 });
    show('p2');
    expect(camera).toMatchObject({ x: -5, zoom: 0.5 });
    cameras.destroy();
  });

  it('fits a page whose stored camera is not a camera or not finite', () => {
    const storage = new MemoryStorage();
    storage.setItem('canvas:page-camera:board:p2', JSON.stringify({ x: 'left', y: 0, zoom: 1 }));
    storage.setItem('canvas:page-camera:board:p3', '{"x":1e999,"y":0,"zoom":1}');
    vi.stubGlobal('localStorage', storage);
    const { pages, show } = fakePages();
    let camera = CAMERA;
    const fitContent = vi.fn();
    const cameras = new PageCameras(
      pages,
      {
        camera: () => camera,
        setCamera: (next) => {
          camera = next;
        },
        fitContent,
      },
      'board',
    );
    show('p2');
    show('p3');
    expect(fitContent).toHaveBeenCalledTimes(2);
    expect(camera).toMatchObject({ x: 0, zoom: 1 });
    cameras.destroy();
  });

  it('works without storage, and wires a mounted engine', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const { pages, show } = fakePages();
    const runCanvasAction = vi.fn();
    const engine = { pages, camera: () => CAMERA, jumpCamera: vi.fn(), runCanvasAction };
    expect(keepPageCameras(engine)).toBe(engine);
    show('p2');
    expect(runCanvasAction).toHaveBeenCalledWith({ type: 'navigate', command: 'zoomToFit' });
  });
});
