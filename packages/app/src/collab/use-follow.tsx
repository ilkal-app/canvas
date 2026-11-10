import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

import type { PresenceViewport } from '@canvas/collab';
import { clampZoom } from '@canvas/engine';
import type { PageId } from '@canvas/schema';

import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { useAnnounce } from '../feedback/live-announcer.js';
import { useToast } from '../feedback/toast-region.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import type { BoardConnection } from './board-connection.js';
import { FollowController, type FollowView } from './follow-controller.js';

/**
 * The person's own camera moves: the engine reports them (`onCameraInput`), and the
 * follow stops on them. A tiny signal, created once by the shell and handed to both.
 */
export class CameraInputSignal {
  readonly #listeners = new Set<() => void>();

  /** Says the person moved the camera. */
  readonly emit = (): void => {
    for (const listener of [...this.#listeners]) listener();
  };

  /**
   * Calls back on each camera move of the person's.
   *
   * @param listener - Called with no arguments.
   * @returns Stops listening.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

const CameraInputContext = createContext<CameraInputSignal | undefined>(undefined);

/** Provides the shell's camera-input signal. */
export const CameraInputProvider = CameraInputContext.Provider;

/**
 * The shell's camera-input signal, which the engine emits on and the follow listens to.
 *
 * @returns The signal, or `undefined` outside a shell.
 */
export function useCameraInput(): CameraInputSignal | undefined {
  return useContext(CameraInputContext);
}

const FollowContext = createContext<FollowController | undefined>(undefined);

/**
 * The board's follow controller, for the presence bar and the follow frame.
 *
 * @returns The controller, or `undefined` on a board without presence.
 */
export function useFollowController(): FollowController | undefined {
  return useContext(FollowContext);
}

/** Following nobody, for a board without presence. */
const IDLE_VIEW: FollowView = Object.freeze({
  follow: Object.freeze({ kind: 'idle' as const }),
  isSpotlighting: false,
  audience: 0,
  canSpotlight: false,
});

/**
 * What the follow shows now, re-rendering when it changes.
 *
 * @param controller - The controller, if any.
 * @returns Its view, or idle.
 */
export function useFollowView(controller: FollowController | undefined): FollowView {
  return useSyncExternalStore(
    (listener) => controller?.subscribe(listener) ?? (() => undefined),
    () => controller?.view() ?? IDLE_VIEW,
  );
}

/** Props of {@link FollowProvider}. */
export interface FollowProviderProps {
  /** The board's connection; no follow without presence. */
  readonly connection: BoardConnection | undefined;
  /** The engine, whose camera and pages the follow moves. */
  readonly engine: MountedEngine | undefined;
  /** The camera, for the screen's size. */
  readonly camera: CameraSource | undefined;
  /** What sees the controller. */
  readonly children: ReactNode;
}

/**
 * Runs following and the spotlight on a board with presence: a {@link FollowController}
 * over the connection's presence, moving the engine's camera and page, announcing in the live
 * region and toasting a spotlight; Esc and the person's own camera moves stop a follow.
 *
 * @param props - The connection, engine, camera and children; the camera-input signal comes
 *   from {@link CameraInputProvider}.
 * @returns The children, with the controller in context.
 */
export function FollowProvider(props: FollowProviderProps): ReactElement {
  const { connection, engine, camera } = props;
  const cameraInput = useCameraInput();
  const announce = useAnnounce();
  const [toast, setToast] = useState<{ readonly message: string; readonly key: number }>();
  const [controller, setController] = useState<FollowController>();
  useEffect(() => {
    if (connection?.localPresence === undefined || engine === undefined) return undefined;
    const showViewport = (viewport: PresenceViewport): void => {
      const shown = engine.camera();
      const zoom = clampZoom(viewport.zoom);
      engine.jumpCamera?.({ ...shown, x: viewport.x, y: viewport.y, zoom });
    };
    const next = new FollowController({
      remote: () => connection.remotePresence?.() ?? new Map(),
      local: () => connection.localPresence?.(),
      subscribe: (listener) => connection.subscribe(listener),
      showSpotlight: (spotlight) => connection.showSpotlight?.(spotlight),
      showFollowing: (principalId) => connection.showFollowing?.(principalId),
      screen: () => {
        const shown = camera?.read();
        return shown === undefined
          ? undefined
          : { widthPx: shown.viewportWidthPx, heightPx: shown.viewportHeightPx };
      },
      showViewport,
      showPage: (pageId) => engine.pages?.show(pageId as PageId),
      announce: (message, isToast) => {
        announce(message);
        if (isToast) setToast((last) => ({ message, key: (last?.key ?? 0) + 1 }));
      },
      now: () => Date.now(),
      canSpotlight: () => !connection.status().isReadOnly,
    });
    setController(next);
    const stopInput = cameraInput?.subscribe(() => {
      next.stop('camera');
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isImeKey(event)) return;
      if (next.view().follow.kind === 'following') next.stop('escape');
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      stopInput?.();
      window.removeEventListener('keydown', onKey, true);
      next.endSpotlight();
      next.destroy();
      setController(undefined);
    };
  }, [connection, engine, camera, cameraInput, announce]);
  const shown = useToast(
    toast === undefined
      ? undefined
      : { kind: 'info', message: toast.message, key: String(toast.key) },
  );
  return (
    <FollowContext.Provider value={controller}>
      {props.children}
      {shown}
    </FollowContext.Provider>
  );
}
