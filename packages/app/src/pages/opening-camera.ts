import { useEffect, useRef } from 'react';

import type { Camera } from '@canvas/engine';

import type { BoardConnection } from '../collab/board-connection.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { OBJECT_PARAMETER } from '../links/object-link.js';

import { pageCameraBoardKey, savePageCamera } from './page-cameras.js';
import type { PageNavigation } from './page-navigator.js';

/** How long the camera stays still before it is stored, ms: never a write per frame. */
export const OPENING_CAMERA_SAVE_MS = 400;

/**
 * How long the opening's content stays still before the fit stops following it, ms: a board that
 * arrives in batches (its cached copy, then the live one) is fitted to all of them.
 */
export const OPENING_FIT_QUIET_MS = 1500;

/**
 * The device's switch for the opening fit: `off` opens boards where the camera starts (the
 * origin), for the scenario specs that place things by screen point (round 2, the
 * coordinator's option a); any other value, or none, fits.
 */
export const OPENING_FIT_STORAGE_KEY = 'canvas.opening-fit';

/**
 * Whether the device turned the opening fit off ({@link OPENING_FIT_STORAGE_KEY}); wrapped
 * against storage that throws.
 *
 * @returns True when it is off.
 */
function isOpeningFitOff(): boolean {
  try {
    return globalThis.localStorage.getItem(OPENING_FIT_STORAGE_KEY) === 'off';
  } catch {
    return false;
  }
}

/** The person's own input, which ends a fit still waiting for the board's content. */
const INPUT_EVENTS = ['pointerdown', 'wheel', 'keydown'] as const;

/** What {@link OpeningCamera} reads and moves. */
export interface OpeningCameraHost {
  /** The pages: the page shown and how many objects it holds. */
  readonly pages: Pick<PageNavigation, 'current' | 'objectCount' | 'whenShown'>;
  /** Resolves once the engine runs. */
  readonly ready: Promise<void>;
  /**
   * Resolves once the board's content is loaded: the relay's first sync, or the device's copy
   * where there is no relay to wait for (offline, local only); at once if absent.
   */
  readonly loaded?: Promise<void> | undefined;
  /** The camera shown. */
  readonly camera: () => Camera;
  /** Zooms to fit the page shown. */
  readonly fitContent: () => void;
  /** Listens for document changes; returns what stops listening. */
  readonly subscribeDocument: (listener: () => void) => () => void;
  /** Listens for camera changes; returns what stops listening. */
  readonly subscribeCamera: (listener: () => void) => () => void;
  /** Where the person's input is heard (the window); none listens if absent. */
  readonly inputTarget?: EventTarget | undefined;
  /** Whether the board was opened by a link to an object, which frames that object instead. */
  readonly isLinkedToObject: boolean;
  /** The board's key in storage; the page's address if absent. */
  readonly board?: string | undefined;
}

/**
 * A board's opening camera (item 1; round 2, the owner: every opening, not only the
 * first): whenever a person opens a board, once its content is loaded (the relay's first sync, or
 * the device's copy offline) the view zooms to fit the page's content, and again while that
 * opening content keeps arriving (sliced pages), until it has been still for
 * {@link OPENING_FIT_QUIET_MS}. A page empty once loaded is left alone, so a collaborator's first
 * object never moves anyone's view. The fit waits no longer once the person acts (a press, a
 * wheel, a key), another page shows, or the board was opened by a link to an object, which
 * frames that object. Reconnecting and switching pages are not openings: the engine stays
 * mounted, and `PageCameras` sets a switched page's camera. Once the opening is settled, the
 * camera is stored {@link OPENING_CAMERA_SAVE_MS} after it stops and when the page is hidden,
 * where `PageCameras` finds it when the page is shown again. Main thread.
 */
export class OpeningCamera {
  readonly #host: OpeningCameraHost;
  readonly #board: string;
  readonly #stops: (() => void)[] = [];
  #isSettled = false;
  #isDestroyed = false;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Waits to fit the board's page shown, unless a link to an object opened it.
   *
   * @param host - The pages, the camera and the signals.
   */
  constructor(host: OpeningCameraHost) {
    this.#host = host;
    this.#board = host.board ?? pageCameraBoardKey();
    // Every opening fits (round 2), whatever was stored; a link to an object frames it.
    if (host.isLinkedToObject) this.#settle();
    else this.#waitToFit();
  }

  /** Stores the camera now, if the opening is settled, and stops. */
  destroy(): void {
    if (this.#isDestroyed) return;
    this.#save();
    this.#isDestroyed = true;
    clearTimeout(this.#saveTimer);
    for (const stop of this.#stops.splice(0)) stop();
  }

  /**
   * Waits for the engine, the board's load and the page's slices, then fits the page's content;
   * fits again for content that keeps arriving until it has been still for
   * {@link OPENING_FIT_QUIET_MS}, the person acts, or another page shows. A page empty once loaded
   * ends the wait.
   */
  #waitToFit(): void {
    const host = this.#host;
    const page = host.pages.current();
    let isDone = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let stopDocument: (() => void) | undefined;
    const target = host.inputTarget;
    // Ends the wait: no more fits, no more listening for content or input.
    const stopWaiting = (): void => {
      isDone = true;
      clearTimeout(quiet);
      stopDocument?.();
      for (const type of INPUT_EVENTS) target?.removeEventListener(type, finish, { capture: true });
    };
    // Ends it and keeps the camera from now on: only while the opening page still shows. Another
    // page (the opening one deleted, say) is PageCameras' to set, and nothing here keeps its
    // camera, so a page not fitted yet is never stored unfitted.
    function finish(): void {
      stopWaiting();
      if (host.pages.current() === page) settle();
    }
    const settle = (): void => {
      this.#settle();
    };
    const tryFit = (): void => {
      if (isDone || this.#isDestroyed) return;
      if (host.pages.current() !== page) {
        stopWaiting();
        return;
      }
      if (host.pages.objectCount(page) === 0) return;
      // Settled first, so the fitted camera is the one kept.
      this.#settle();
      host.fitContent();
      clearTimeout(quiet);
      quiet = setTimeout(finish, OPENING_FIT_QUIET_MS);
    };
    for (const type of INPUT_EVENTS) target?.addEventListener(type, finish, { capture: true });
    this.#stops.push(stopWaiting);
    void host.ready
      .then(() => host.loaded)
      .then(() => host.pages.whenShown?.())
      .then(() => {
        if (isDone || this.#isDestroyed) return;
        // Nothing on the page once loaded: nothing to fit, and later content is the board's life.
        if (host.pages.current() === page && host.pages.objectCount(page) === 0) {
          finish();
          return;
        }
        stopDocument = host.subscribeDocument(tryFit);
        tryFit();
      })
      .catch(() => undefined); // The shell reports an engine that does not start.
  }

  /** Stops waiting and starts keeping the camera. */
  #settle(): void {
    if (this.#isSettled || this.#isDestroyed) return;
    this.#isSettled = true;
    this.#stops.push(
      this.#host.subscribeCamera(() => {
        clearTimeout(this.#saveTimer);
        this.#saveTimer = setTimeout(() => {
          this.#save();
        }, OPENING_CAMERA_SAVE_MS);
      }),
    );
    const onHide = (): void => {
      this.#save();
    };
    window.addEventListener('pagehide', onHide);
    this.#stops.push(() => {
      window.removeEventListener('pagehide', onHide);
    });
  }

  /** Stores the page's camera, once the opening is settled. */
  #save(): void {
    if (!this.#isSettled || this.#isDestroyed) return;
    savePageCamera(this.#board, this.#host.pages.current(), this.#host.camera());
  }
}

/**
 * Whether the page was opened by a link to an object (`object=<id>`).
 *
 * @returns True when the address names an object.
 */
function isLinkedToObject(): boolean {
  return (
    typeof location !== 'undefined' &&
    new URL(location.href).searchParams.get(OBJECT_PARAMETER) !== null
  );
}

/**
 * When the board is loaded, following whichever connection the shell has now: it resolves once
 * that connection leaves `connecting` (its first sync, or offline with the device's copy, local
 * only, refused). A connection swapped for another over the same board (a session that ended
 * turns view-only) is followed, never treated as another load. Without a connection
 * when it starts (a host with no relay), it resolves at once.
 */
class BoardLoad {
  readonly loaded: Promise<void>;
  #resolve: () => void = () => undefined;
  #isLoaded = false;
  #stop: () => void = () => undefined;

  /**
   * Follows the connection the shell has as the engine mounts.
   *
   * @param connection - The board's connection, if any yet.
   */
  constructor(connection: OpeningConnection | undefined) {
    this.loaded = new Promise<void>((resolve) => {
      this.#resolve = resolve;
    });
    if (connection === undefined) this.#done();
    else this.follow(connection);
  }

  /**
   * Follows the shell's connection now.
   *
   * @param connection - The connection; none leaves the last one followed.
   */
  follow(connection: OpeningConnection | undefined): void {
    if (this.#isLoaded || connection === undefined) return;
    this.#stop();
    const check = (): void => {
      if (connection.status().state !== 'connecting') this.#done();
    };
    this.#stop = connection.subscribe(check);
    check();
  }

  /** Stops following. */
  stop(): void {
    this.#stop();
  }

  /** Resolves, once. */
  #done(): void {
    if (this.#isLoaded) return;
    this.#isLoaded = true;
    this.#stop();
    this.#resolve();
  }
}

/** What the opening reads of the board's connection. */
export type OpeningConnection = Pick<BoardConnection, 'status' | 'subscribe'>;

/**
 * Gives a board's opening its camera ({@link OpeningCamera}, item 1) once the engine
 * is mounted, where the host asks for it (the site's board page).
 *
 * @param engine - The engine, once mounted.
 * @param camera - The camera's source, which the engine writes.
 * @param isOn - Whether the board fits when it opens.
 * @param connection - The board's connection, whose first sync the fit waits for, followed if
 *   swapped; none if absent.
 */
export function useOpeningCamera(
  engine: MountedEngine | undefined,
  camera: CameraSource,
  isOn: boolean,
  connection?: OpeningConnection,
): void {
  const connectionRef = useRef(connection);
  const loadRef = useRef<BoardLoad | undefined>(undefined);
  // One opening per mounted engine: a connection swapped under it is followed, not reopened.
  useEffect(() => {
    connectionRef.current = connection;
    loadRef.current?.follow(connection);
  }, [connection]);
  useEffect(() => {
    const pages = engine?.pages;
    if (!isOn || engine === undefined || pages === undefined || isOpeningFitOff()) {
      return undefined;
    }
    const load = new BoardLoad(connectionRef.current);
    loadRef.current = load;
    const opening = new OpeningCamera({
      pages,
      ready: engine.ready,
      loaded: load.loaded,
      camera: () => engine.camera(),
      fitContent: () => {
        engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
      },
      subscribeDocument: (listener) =>
        engine.board.subscribe((change) => {
          if (change.kind === 'document') listener();
        }),
      subscribeCamera: camera.subscribe,
      inputTarget: window,
      isLinkedToObject: isLinkedToObject(),
    });
    return () => {
      load.stop();
      if (loadRef.current === load) loadRef.current = undefined;
      opening.destroy();
    };
  }, [engine, camera, isOn]);
}
