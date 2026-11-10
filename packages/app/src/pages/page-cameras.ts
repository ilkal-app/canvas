import type { Camera } from '@canvas/engine';
import type { PageId } from '@canvas/schema';

import type { PageNavigation } from './page-navigator.js';

/** Where a page's camera is kept, as stored. */
interface StoredCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The key prefix of the page cameras in `localStorage`. */
const KEY_PREFIX = 'canvas:page-camera:';

/** What the cameras move and read. */
export interface PageCameraHost {
  /** The camera shown. */
  readonly camera: () => Camera;
  /** Shows a camera at once. */
  readonly setCamera: (camera: Camera) => void;
  /** Zooms to fit the page shown, for a page never seen. */
  readonly fitContent: () => void;
}

/**
 * Reads a stored camera, wrapped against storage that throws or holds something else.
 *
 * @param key - The storage key.
 * @returns The camera, or `undefined`.
 */
function load(key: string): StoredCamera | undefined {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage.getItem(key) ?? 'null');
    if (typeof value !== 'object' || value === null) return undefined;
    const { x, y, zoom } = value as Record<string, unknown>;
    const isCamera =
      typeof x === 'number' && typeof y === 'number' && typeof zoom === 'number' && zoom > 0;
    return isCamera && [x, y, zoom].every(Number.isFinite) ? { x, y, zoom } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stores a camera, wrapped against storage that throws (a private window, a full quota).
 *
 * @param key - The storage key.
 * @param camera - The camera.
 */
function save(key: string, camera: Camera): void {
  try {
    const stored: StoredCamera = { x: camera.x, y: camera.y, zoom: camera.zoom };
    globalThis.localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // The camera is a convenience: without storage, a page opens where the last one was.
  }
}

/**
 * The board's key in storage: the page's address, which names the board on the site.
 *
 * @returns The key; `board` without a location.
 */
export function pageCameraBoardKey(): string {
  return typeof location === 'undefined' ? 'board' : location.pathname;
}

/**
 * The storage key of a page's camera.
 *
 * @param board - The board's key.
 * @param page - The page.
 * @returns The key.
 */
function keyOf(board: string, page: PageId): string {
  return `${KEY_PREFIX}${board}:${page}`;
}

/**
 * A page's stored camera, as {@link PageCameras} keeps it (item 1 reads it on opening).
 *
 * @param board - The board's key (`pageCameraBoardKey`).
 * @param page - The page.
 * @returns Its position and zoom, or `undefined` when none is stored or it is not a camera.
 */
export function loadPageCamera(
  board: string,
  page: PageId,
): Pick<Camera, 'x' | 'y' | 'zoom'> | undefined {
  return load(keyOf(board, page));
}

/**
 * Stores a page's camera, as {@link PageCameras} keeps it.
 *
 * @param board - The board's key (`pageCameraBoardKey`).
 * @param page - The page.
 * @param camera - The camera.
 */
export function savePageCamera(board: string, page: PageId, camera: Camera): void {
  save(keyOf(board, page), camera);
}

/**
 * Each page's camera, per person and device (`localStorage`, keyed by board
 * and page): leaving a page keeps its camera; showing a page puts back its camera, and a
 * page never seen opens zoomed to fit its content. Main thread.
 */
export class PageCameras {
  readonly #pages: PageNavigation;
  readonly #host: PageCameraHost;
  readonly #board: string;
  readonly #stop: () => void;
  #page: PageId;

  /**
   * Follows the page shown.
   *
   * @param pages - The pages.
   * @param host - The camera.
   * @param board - The board's key; its address on the site by default.
   */
  constructor(pages: PageNavigation, host: PageCameraHost, board = pageCameraBoardKey()) {
    this.#pages = pages;
    this.#host = host;
    this.#board = board;
    this.#page = pages.current();
    this.#stop = pages.subscribe(() => {
      this.#follow();
    });
  }

  /** Stops following. */
  destroy(): void {
    this.#stop();
  }

  /**
   * The storage key of a page's camera.
   *
   * @param page - The page.
   * @returns The key.
   */
  #key(page: PageId): string {
    return keyOf(this.#board, page);
  }

  /** Keeps the camera of the page left and shows the page shown at its own. */
  #follow(): void {
    const page = this.#pages.current();
    if (page === this.#page) return;
    save(this.#key(this.#page), this.#host.camera());
    this.#page = page;
    const stored = load(this.#key(page));
    // The camera is set either way, so the page's scene goes to the engine at once.
    this.#host.setCamera({ ...this.#host.camera(), ...stored });
    if (stored !== undefined) return;
    // A page never seen fits its content once all of it is announced (a sliced switch,
    //), unless the person has left it meanwhile.
    const shown = this.#pages.whenShown?.();
    if (shown === undefined) this.#host.fitContent();
    else {
      void shown.then(() => {
        if (this.#pages.current() === page) this.#host.fitContent();
      });
    }
  }
}

/** A mounted engine whose pages keep their cameras. */
export interface CameraEngine {
  /** The pages. */
  readonly pages: PageNavigation;
  /** The camera shown. */
  camera(): Camera;
  /** Shows a camera at once. */
  jumpCamera(camera: Camera): void;
  /** Runs zoom to fit, among other canvas actions. */
  runCanvasAction(action: { readonly type: 'navigate'; readonly command: 'zoomToFit' }): void;
}

/**
 * Gives a mounted engine's pages their cameras (`PageCameras`); they go with the pages when
 * the engine's document side is destroyed.
 *
 * @param engine - The engine.
 * @returns The engine.
 */
export function keepPageCameras<Engine extends CameraEngine>(engine: Engine): Engine {
  new PageCameras(engine.pages, {
    camera: () => engine.camera(),
    setCamera: (camera) => {
      engine.jumpCamera(camera);
    },
    fitContent: () => {
      engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    },
  });
  return engine;
}
