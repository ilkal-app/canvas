import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';

import { appendToActionLog } from './action-log.js';
import type {
  CanvasHarness,
  CanvasHarnessAttribute,
  CanvasHarnessHost,
  HarnessPanels,
  HarnessTheme,
} from './canvas-harness.js';
import { flushHarnessFrames } from './harness-frames.js';
import { measureCanvas } from './measure-canvas.js';
import { storeRunHarness } from './store-run-harness.js';

const HARNESS_ATTRIBUTE: CanvasHarnessAttribute = 'data-canvas-harness';

/** What the shell hands its test harness on every render. */
export interface ShellHarnessInputs {
  /** The shell reducer's state. */
  readonly state: ShellState;
  /** The shell reducer's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
  /** The shortcuts the shell matches key presses against. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The theme in effect. */
  readonly theme: HarnessTheme;
  /** The engine mounted on the canvas, if any: the camera and pixel capture come from it. */
  readonly engineRef: RefObject<MountedEngine | undefined>;
  /** The board's connection, when the shell has one: its status and its document. */
  readonly connection?: BoardConnection | undefined;
  /** What the panels show. */
  readonly panels: HarnessPanels;
}

/**
 * Exposes the shell to scenario tests: marks the shell's root element with
 * `data-canvas-harness` and attaches a {@link CanvasHarness} to it as `canvasHarness`, and
 * returns a dispatch that logs every action before passing it on. The harness reads the latest
 * inputs whenever it is asked, and is removed when the shell unmounts. The shell calls it only
 * when built with `VITE_CANVAS_HARNESS=1` (see `useShellHarness`).
 *
 * @param rootRef - The shell's root element.
 * @param inputs - The shell's state, dispatch, shortcuts and theme.
 * @returns A dispatch to use instead of the reducer's, which logs each action.
 */
export function useCanvasHarness(
  rootRef: RefObject<HTMLElement | null>,
  inputs: ShellHarnessInputs,
): (action: ShellAction) => void {
  const latestRef = useRef(inputs);
  // A run the harness holds ends with the harness, or when the shell's board changes.
  const runs = useMemo(() => storeRunHarness(() => latestRef.current.connection?.store), []);
  useEffect(() => runs.release, [runs, inputs.connection]);
  useLayoutEffect(() => {
    latestRef.current = inputs;
  });
  const actionLogRef = useRef<readonly ShellAction[]>([]);
  const { dispatch } = inputs;
  const loggingDispatch = useCallback(
    (action: ShellAction) => {
      actionLogRef.current = appendToActionLog(actionLogRef.current, action);
      dispatch(action);
    },
    [dispatch],
  );

  useLayoutEffect(() => {
    const root: CanvasHarnessHost | null = rootRef.current;
    if (root === null) return undefined;
    const findCanvas = (): HTMLCanvasElement | null => root.querySelector('canvas');
    const harness: CanvasHarness = {
      snapshot: () => {
        flushHarnessFrames();
        const { state, registry, theme, engineRef, panels } = latestRef.current;
        const canvas = findCanvas();
        return {
          shellState: state,
          dispatchedActions: actionLogRef.current,
          shortcutRegistry: registry,
          theme,
          canvas:
            canvas === null ? undefined : measureCanvas(canvas, engineRef.current?.drawingBuffer()),
          camera: engineRef.current?.camera(),
          document: engineRef.current?.inspect(),
          connection: latestRef.current.connection?.status(),
          panels,
        };
      },
      readObject: (id) => latestRef.current.connection?.store.get(id as ObjectId),
      readObjects: () => [...(latestRef.current.connection?.store.read().objects.values() ?? [])],
      beginStoreRun: runs.beginStoreRun,
      reportStoreRunProgress: runs.reportStoreRunProgress,
      endStoreRun: runs.endStoreRun,
      readPixels: (rect) => {
        const engine = latestRef.current.engineRef.current;
        if (findCanvas() === null || engine === undefined) {
          return Promise.reject(new Error('The shell has no canvas with an engine to read.'));
        }
        return engine.capturePixels(rect);
      },
    };
    root.canvasHarness = harness;
    root.setAttribute(HARNESS_ATTRIBUTE, '');
    return () => {
      root.removeAttribute(HARNESS_ATTRIBUTE);
      delete root.canvasHarness;
    };
  }, [rootRef, runs]);

  return loggingDispatch;
}
