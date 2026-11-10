// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { PageId } from '@canvas/schema';

import {
  OPENING_CAMERA_SAVE_MS,
  OPENING_FIT_QUIET_MS,
  OpeningCamera,
  type OpeningCameraHost,
} from './opening-camera.js';
import { loadPageCamera, savePageCamera } from './page-cameras.js';

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

const PAGE = 'page-1' as PageId;

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

/** A host whose content, camera and signals a test drives. */
interface FakeHost {
  readonly host: OpeningCameraHost;
  readonly fitContent: ReturnType<typeof vi.fn>;
  readonly input: EventTarget;
  camera: Camera;
  objects: number;
  page: PageId;
  changeDocument(): void;
  moveCamera(camera: Camera): void;
}

/**
 * A host for one opening.
 *
 * @param fields - What the host differs in.
 * @param fields.objects - How many objects the page holds at first.
 * @param fields.isLinkedToObject - Whether the board was opened by a link to an object.
 * @param fields.loaded - When the board's content is loaded; at once if absent.
 * @returns The host and its controls.
 */
function fakeHost(
  fields: { objects?: number; isLinkedToObject?: boolean; loaded?: Promise<void> } = {},
): FakeHost {
  const documentListeners = new Set<() => void>();
  const cameraListeners = new Set<() => void>();
  const input = new EventTarget();
  const fake: FakeHost = {
    camera: CAMERA,
    objects: fields.objects ?? 0,
    page: PAGE,
    input,
    fitContent: vi.fn(),
    changeDocument: () => {
      for (const listener of documentListeners) listener();
    },
    moveCamera: (camera) => {
      fake.camera = camera;
      for (const listener of cameraListeners) listener();
    },
    host: undefined as unknown as OpeningCameraHost,
  };
  const host: OpeningCameraHost = {
    pages: { current: () => fake.page, objectCount: () => fake.objects },
    ready: Promise.resolve(),
    loaded: fields.loaded,
    camera: () => fake.camera,
    fitContent: () => {
      fake.fitContent();
      fake.moveCamera({ ...fake.camera, x: -100, zoom: 0.5 });
    },
    subscribeDocument: (listener) => {
      documentListeners.add(listener);
      return () => documentListeners.delete(listener);
    },
    subscribeCamera: (listener) => {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },
    inputTarget: input,
    isLinkedToObject: fields.isLinkedToObject ?? false,
    board: 'board',
  };
  return Object.assign(fake, { host });
}

/**
 * A board load a test finishes.
 *
 * @returns The promise and what resolves it.
 */
function deferredLoad(): { readonly loaded: Promise<void>; readonly load: () => void } {
  let load = (): void => undefined;
  const loaded = new Promise<void>((resolve) => {
    load = resolve;
  });
  return { loaded, load };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OpeningCamera (item 1)', () => {
  it('fits a board as it opens, once its content is there', async () => {
    const fake = fakeHost({ objects: 3 });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    expect(fake.fitContent).toHaveBeenCalledTimes(1);
    // The fitted camera is kept for the next opening, once the camera stops.
    expect(loadPageCamera('board', PAGE)).toEqual({ x: -100, y: 0, zoom: 0.5 });
    opening.destroy();
  });

  it('waits for the board to load, then follows its batches until they are still', async () => {
    const { loaded, load } = deferredLoad();
    const fake = fakeHost({ loaded });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    // The cached copy arrives while the live board loads: nothing fits yet.
    fake.objects = 5;
    fake.changeDocument();
    expect(fake.fitContent).not.toHaveBeenCalled();
    load();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.fitContent).toHaveBeenCalledTimes(1);
    // A later slice of the opening content: fitted again.
    vi.advanceTimersByTime(OPENING_FIT_QUIET_MS - 1);
    fake.objects = 9;
    fake.changeDocument();
    expect(fake.fitContent).toHaveBeenCalledTimes(2);
    // Still for long enough: later changes are the board's life, not its opening.
    vi.advanceTimersByTime(OPENING_FIT_QUIET_MS);
    fake.changeDocument();
    expect(fake.fitContent).toHaveBeenCalledTimes(2);
    opening.destroy();
  });

  it('leaves a page that is empty once loaded alone, whatever a collaborator adds', async () => {
    const fake = fakeHost();
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    fake.objects = 1;
    fake.changeDocument();
    await vi.runAllTimersAsync();
    expect(fake.fitContent).not.toHaveBeenCalled();
    opening.destroy();
  });

  it('stops following the content once the person acts', async () => {
    const fake = fakeHost({ objects: 2 });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    expect(fake.fitContent).toHaveBeenCalledTimes(1);
    const again = fakeHost({ objects: 2 });
    const second = new OpeningCamera(again.host);
    // The engine's ready and the page's slices, without running the quiet timer.
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(again.fitContent).toHaveBeenCalledTimes(1);
    again.input.dispatchEvent(new Event('wheel'));
    again.changeDocument();
    expect(again.fitContent).toHaveBeenCalledTimes(1);
    second.destroy();
    opening.destroy();
  });

  it('leaves the camera alone once another page shows while it waits', async () => {
    const { loaded, load } = deferredLoad();
    const fake = fakeHost({ loaded });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    fake.page = 'page-2' as PageId;
    fake.objects = 4;
    load();
    await vi.advanceTimersByTimeAsync(0);
    fake.changeDocument();
    fake.page = PAGE;
    fake.changeDocument();
    expect(fake.fitContent).not.toHaveBeenCalled();
    // Nor does it keep the other page's camera, which PageCameras may not have fitted yet, even
    // after the person acts there.
    fake.page = 'page-2' as PageId;
    fake.input.dispatchEvent(new Event('pointerdown'));
    fake.moveCamera({ ...CAMERA, x: 7 });
    window.dispatchEvent(new Event('pagehide'));
    await vi.runAllTimersAsync();
    opening.destroy();
    expect(loadPageCamera('board', 'page-2' as PageId)).toBeUndefined();
  });

  it('fits on every opening, a stored camera or not, and stores where it is left', async () => {
    savePageCamera('board', PAGE, { ...CAMERA, x: 40, y: 7, zoom: 2 });
    const fake = fakeHost({ objects: 3 });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    expect(fake.fitContent).toHaveBeenCalledTimes(1);
    expect(loadPageCamera('board', PAGE)).toEqual({ x: -100, y: 0, zoom: 0.5 });
    fake.moveCamera({ ...CAMERA, x: 41, y: 7, zoom: 2 });
    fake.moveCamera({ ...CAMERA, x: 42, y: 7, zoom: 2 });
    vi.advanceTimersByTime(OPENING_CAMERA_SAVE_MS - 1);
    expect(loadPageCamera('board', PAGE)?.x).toBe(-100);
    vi.advanceTimersByTime(1);
    expect(loadPageCamera('board', PAGE)?.x).toBe(42);
    fake.moveCamera({ ...CAMERA, x: 50, y: 7, zoom: 2 });
    opening.destroy();
    expect(loadPageCamera('board', PAGE)?.x).toBe(50);
    // Opened again: fitted again.
    const again = fakeHost({ objects: 3 });
    const next = new OpeningCamera(again.host);
    await vi.runAllTimersAsync();
    expect(again.fitContent).toHaveBeenCalledTimes(1);
    next.destroy();
  });

  it('does not fit once the person acts, nor for a link to an object', async () => {
    const acted = fakeHost();
    const first = new OpeningCamera(acted.host);
    acted.input.dispatchEvent(new Event('pointerdown'));
    await vi.runAllTimersAsync();
    acted.objects = 1;
    acted.changeDocument();
    expect(acted.fitContent).not.toHaveBeenCalled();
    first.destroy();

    const linked = fakeHost({ objects: 2, isLinkedToObject: true });
    const second = new OpeningCamera(linked.host);
    await vi.runAllTimersAsync();
    expect(linked.fitContent).not.toHaveBeenCalled();
    second.destroy();
  });

  it('stores nothing while it still waits to fit, nor after it is destroyed', async () => {
    const fake = fakeHost({ loaded: deferredLoad().loaded });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    fake.moveCamera({ ...CAMERA, x: 9 });
    opening.destroy();
    opening.destroy();
    fake.objects = 1;
    fake.changeDocument();
    await vi.runAllTimersAsync();
    expect(fake.fitContent).not.toHaveBeenCalled();
    expect(loadPageCamera('board', PAGE)).toBeUndefined();
  });

  it('keeps no camera when the person acts after another page shows, before any change', async () => {
    const fake = fakeHost({ loaded: deferredLoad().loaded });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    fake.page = 'page-2' as PageId;
    fake.input.dispatchEvent(new Event('keydown'));
    fake.moveCamera({ ...CAMERA, x: 3 });
    await vi.runAllTimersAsync();
    opening.destroy();
    expect(loadPageCamera('board', 'page-2' as PageId)).toBeUndefined();
    expect(loadPageCamera('board', PAGE)).toBeUndefined();
  });

  it('stores the camera when the page is hidden', async () => {
    const fake = fakeHost({ objects: 1 });
    const opening = new OpeningCamera(fake.host);
    await vi.runAllTimersAsync();
    fake.camera = { ...CAMERA, x: 3 };
    window.dispatchEvent(new Event('pagehide'));
    expect(loadPageCamera('board', PAGE)?.x).toBe(3);
    opening.destroy();
  });

  it('neither fits nor listens once destroyed before the engine runs, nor if it never runs', async () => {
    const fake = fakeHost({ objects: 3 });
    const opening = new OpeningCamera(fake.host);
    opening.destroy();
    await vi.runAllTimersAsync();
    expect(fake.fitContent).not.toHaveBeenCalled();
    const failed = fakeHost({ objects: 3 });
    const broken = new OpeningCamera({
      ...failed.host,
      ready: Promise.reject(new Error('no GPU')),
    });
    await vi.runAllTimersAsync();
    expect(failed.fitContent).not.toHaveBeenCalled();
    broken.destroy();
  });
});
