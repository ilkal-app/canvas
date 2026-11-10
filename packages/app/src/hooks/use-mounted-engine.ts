import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type EffectCallback,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react';

import type { BenchmarkSample, Camera } from '@canvas/engine';
import type { ToolId } from '@canvas/tools';

import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import type { CanvasMountProps } from '../canvas/canvas-mount.js';
import { operatedWritersOf, type OperatedWritersSource } from '../collab/operated-writers.js';
import type { TextStyleContext } from '../engine/document-text.js';
import type {
  ContextMenuRequest,
  MountedEngine,
  MountEngine,
  MountEngineOptions,
} from '../engine/mounted-engine.js';
import type { PendingEngine, StartPendingEngine } from '../engine/pending-engine.js';
import type { NoticeSink } from '../notices/notice-outline.js';
import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';
import type { RecordedCanvasAction } from '../state/shell-reducer.js';
import { DEFAULT_VIEW_PREFERENCES, type ViewPreferences } from '../state/view-preferences.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import { useEngineAppearance } from './use-engine-appearance.js';

/** What {@link useMountedEngine} gives the shell. */
export interface MountedEngineBinding {
  /** The running engine, or undefined before the canvas mounts and after it unmounts. */
  readonly engineRef: RefObject<MountedEngine | undefined>;
  /**
   * The same engine as state, so what reads it while rendering (the panels, through its
   * `board`) renders again when it mounts or unmounts.
   */
  readonly engine: MountedEngine | undefined;
  /** The canvas mount's `onCanvasReady`: mounts the engine, then calls the host's own callback. */
  readonly onCanvasReady: (canvas: HTMLCanvasElement) => ReturnType<EffectCallback>;
  /** The canvas mount's `onCanvasResize`: resizes the engine, then calls the host's own. */
  readonly onCanvasResize: (size: CanvasBackingSize) => void;
  /**
   * Reads the mounted engine's frame statistics, for the developer overlay; rejects while no
   * engine runs or statistics are not recording.
   */
  readonly readFrameStats: () => Promise<BenchmarkSample>;
  /**
   * Reads the mounted engine's recent frame timestamps, for the developer overlay's
   * frames-per-second figures; empty while no engine runs, no promise needed since it costs
   * nothing beyond what the engine already reports per frame.
   */
  readonly readFrameTimesMs: () => readonly number[];
}

/**
 * Stops the frame statistics of the engine mounted now, which may be a later one than the
 * engine they were started on (a remount started its own).
 *
 * @param engineRef - The shell's engine ref.
 */
function stopMeasuring(engineRef: RefObject<MountedEngine | undefined>): void {
  engineRef.current?.stopFrameStats();
}

/** What {@link useMountedEngine} runs the engine with. */
export interface UseMountedEngineOptions {
  /** Mounts the engine on a canvas (`mountDefaultEngine`). */
  readonly mount: MountEngine;
  /** Optional cancellable preview/hydration startup on the same canvas. */
  readonly startEngine?: StartPendingEngine;
  /** The shell's latest canvas action; a new `sequence` is a new action. */
  readonly lastCanvasAction: RecordedCanvasAction | undefined;
  /** The host's `onCanvasReady` and `onCanvasResize`, if any. */
  readonly hostCallbacks: CanvasMountProps;
  /** Receives the error when the engine cannot start, and its faults after. */
  readonly onError: (error: unknown) => void;
  /** The tool the toolbar shows as pressed; `select` if absent. */
  readonly activeTool?: ToolId;
  /** Whether the person may edit the board (the shell's `canEdit`); true if absent. */
  readonly canEdit?: boolean;
  /** The theme shown: the engine draws objects' `ink` in it; light if absent. */
  readonly themeName?: ThemeName;
  /** The shell's chrome the engine mounts with; classic if absent. */
  readonly whiteboardChrome?: WhiteboardChrome;
  /**
   * Whether the engine records frame statistics (the developer overlay is open); `false` if
   * absent.
   */
  readonly isMeasuringFrames?: boolean;
  /**
   * Receives the sentence the shell shows when a canvas action does nothing and the person
   * should know why (grouping objects with different parents), and for an undo another
   * person's change kept, who and what; none if absent.
   */
  readonly onNotice?: NoticeSink;
  /** Whether the grid shows and drags snap; the defaults if absent. */
  readonly viewPreferences?: ViewPreferences;
  /**
   * Receives the tool the canvas made active (a tool mode that finished, an activated object's
   * mode), so the toolbar follows; nothing if absent.
   */
  readonly onToolChange?: (tool: ToolId) => void;
  /** Receives the text style the style panel shows whenever it changes; nothing if absent. */
  readonly onTextStyleChange?: (context: TextStyleContext | undefined) => void;
  /** Receives the camera whenever it may have changed (`MountEngineOptions.onCameraChange`). */
  readonly onCameraChange?: (camera: Camera) => void;
  /** Told when the person moves the camera themselves (`MountEngineOptions.onCameraInput`). */
  readonly onCameraInput?: () => void;
  /**
   * The board the engine edits and who the edits are attributed to (a synced store from
   * `openBoardConnection`), and, from its connection, whose agents' changes the person's undo
   * history records (`operatedWritersOf`); the mount's own demo document if absent.
   * Read when the canvas mounts.
   */
  readonly document?: Pick<MountEngineOptions, 'store' | 'origin' | 'images'> &
    OperatedWritersSource;
  /**
   * Opens the shell's context menu when the canvas asks for it (a long-press or a secondary
   * click), with the engine to read the selection from; the latest one given is called. Nothing
   * opens if absent.
   */
  readonly onContextMenu?: (request: ContextMenuRequest, engine: MountedEngine) => void;
}

/** The page steps of the navigation commands that move between pages. */
const PAGE_STEPS: Partial<Readonly<Record<string, -1 | 1>>> = {
  previousPage: -1,
  nextPage: 1,
};

/**
 * Records the mounted engine's frame statistics while the developer overlay shows them, and
 * reads them.
 *
 * @param engineRef - The shell's engine ref.
 * @param isMeasuringFrames - Whether the engine records frame statistics.
 * @returns Reads the statistics; rejects while no engine runs or they are not recording.
 */
function useFrameStats(
  engineRef: RefObject<MountedEngine | undefined>,
  isMeasuringFrames: boolean,
): () => Promise<BenchmarkSample> {
  useEffect(() => {
    if (!isMeasuringFrames) return undefined;
    engineRef.current?.startFrameStats();
    return () => {
      stopMeasuring(engineRef);
    };
  }, [engineRef, isMeasuringFrames]);
  return useCallback((): Promise<BenchmarkSample> => {
    const engine = engineRef.current;
    if (engine === undefined) return Promise.reject(new Error('No engine is mounted.'));
    return engine.readFrameStats();
  }, [engineRef]);
}

/** The shell's callbacks for the engine, the latest given. */
interface ShellCallbacks {
  readonly onError: (error: unknown) => void;
  readonly onNotice?: NoticeSink | undefined;
  readonly onContextMenu?:
    ((request: ContextMenuRequest, engine: MountedEngine) => void) | undefined;
  readonly onToolChange?: ((tool: ToolId) => void) | undefined;
  readonly onTextStyleChange?: ((context: TextStyleContext | undefined) => void) | undefined;
  readonly onCameraChange?: ((camera: Camera) => void) | undefined;
  readonly onCameraInput?: (() => void) | undefined;
}

/**
 * The mount's callbacks into the shell, each calling the latest one the shell gave: faults,
 * notices, the context menu with the engine to read the selection from, the tool the canvas
 * makes active, and the text style the text section shows.
 *
 * @param latestRef - The shell's latest callbacks.
 * @param engineRef - The engine mounted now.
 * @returns The mount options' callbacks.
 */
function shellCallbacksOf(
  latestRef: RefObject<ShellCallbacks>,
  engineRef: RefObject<MountedEngine | undefined>,
): Pick<
  MountEngineOptions,
  | 'onFault'
  | 'onNotice'
  | 'onContextMenu'
  | 'onToolChange'
  | 'onTextStyleChange'
  | 'onCameraChange'
  | 'onCameraInput'
> {
  return {
    onFault: (error) => {
      latestRef.current.onError(error);
    },
    onNotice: (...notice) => {
      latestRef.current.onNotice?.(...notice);
    },
    onContextMenu: (request) => {
      const mounted = engineRef.current;
      if (mounted) latestRef.current.onContextMenu?.(request, mounted);
    },
    onToolChange: (tool) => {
      latestRef.current.onToolChange?.(tool);
    },
    onTextStyleChange: (context) => {
      latestRef.current.onTextStyleChange?.(context);
    },
    onCameraChange: (camera) => {
      latestRef.current.onCameraChange?.(camera);
    },
    onCameraInput: () => {
      latestRef.current.onCameraInput?.();
    },
  };
}

interface CanvasEngineContext {
  readonly latestRef: RefObject<
    UseMountedEngineOptions &
      Required<
        Pick<
          UseMountedEngineOptions,
          'activeTool' | 'canEdit' | 'isMeasuringFrames' | 'viewPreferences'
        >
      >
  >;
  readonly sizeRef: RefObject<CanvasBackingSize | undefined>;
  readonly engineRef: RefObject<MountedEngine | undefined>;
  readonly pendingRef: RefObject<PendingEngine | undefined>;
  readonly generation: RefObject<number>;
  readonly setEngineState: Dispatch<SetStateAction<MountedEngine | undefined>>;
}

function mountCanvasEngine(
  canvas: HTMLCanvasElement,
  context: CanvasEngineContext,
): ReturnType<EffectCallback> {
  const {
    mount: mountNow,
    hostCallbacks: host,
    onError: reportFailure,
  } = context.latestRef.current;
  const board = context.latestRef.current.document;
  const { store, origin, images } = board ?? {};
  // The person's undo history records their agents' changes too.
  const operatedWriters = operatedWritersOf(board);
  const mountOptions = {
    initialViewPreferences: context.latestRef.current.viewPreferences,
    initialTheme: context.latestRef.current.themeName ?? 'light',
    // None for the classic chrome, so a classic mount's options are as before.
    ...(context.latestRef.current.whiteboardChrome === 'floating'
      ? { whiteboardChrome: 'floating' as const }
      : {}),
    ...(context.sizeRef.current === undefined ? {} : { viewport: context.sizeRef.current }),
    ...(store === undefined ? {} : { store }),
    ...(origin === undefined ? {} : { origin }),
    ...(images === undefined ? {} : { images }),
    ...(operatedWriters === undefined ? {} : { operatedWriters }),
    ...shellCallbacksOf(context.latestRef, context.engineRef),
  };
  const currentGeneration = ++context.generation.current;
  let isClosed = false;
  let engine: MountedEngine | undefined;
  const accept = (mounted: MountedEngine): void => {
    if (isClosed || currentGeneration !== context.generation.current) {
      mounted.destroy();
      return;
    }
    engine = mounted;
    if (context.sizeRef.current !== undefined) engine.resize(context.sizeRef.current);
    engine.setEditable(context.latestRef.current.canEdit); // First, so a viewer never edits.
    engine.setActiveTool(context.latestRef.current.activeTool);
    engine.setViewPreferences(context.latestRef.current.viewPreferences);
    engine.setTheme(context.latestRef.current.themeName ?? 'light');
    engine.setWhiteboardChrome(context.latestRef.current.whiteboardChrome ?? 'classic');
    if (context.latestRef.current.isMeasuringFrames) engine.startFrameStats();
    context.engineRef.current = engine;
    context.setEngineState(engine);
    engine.ready.catch(reportFailure);
  };
  const pending = context.latestRef.current.startEngine?.(canvas, mountOptions);
  context.pendingRef.current = pending;
  if (pending === undefined) accept(mountNow(canvas, mountOptions));
  else
    void pending.ready.then(accept, (error: unknown) => {
      if (!isClosed && !pending.isCancelled && currentGeneration === context.generation.current)
        reportFailure(error);
    });
  const releaseHost = host.onCanvasReady?.(canvas);
  return () => {
    if (typeof releaseHost === 'function') releaseHost();
    isClosed = true;
    if (pending === undefined) engine?.destroy();
    else pending.destroy();
    if (context.pendingRef.current === pending) context.pendingRef.current = undefined;
    if (context.engineRef.current === engine) context.engineRef.current = undefined;
    context.setEngineState((current) => (current === engine ? undefined : current));
  };
}

/**
 * Runs the engine on the shell's canvas: mounts it when the canvas is ready (through the one
 * `mount` function, so the worker and the main-thread engine host are a one-call swap), keeps it
 * sized, tells it whether the person may edit, the active tool and the person's view
 * preferences (grid and snapping), hands
 * it every new canvas action the shell records (camera, selection and history shortcuts),
 * records its frame statistics while the developer overlay shows them, and tears it down with
 * the canvas. The host's own canvas callbacks still run.
 *
 * @param options - The mount, the latest canvas action, the host's callbacks, where errors,
 *   notices and context menu requests go, the active tool, whether frames are measured, the
 *   view preferences and the board to edit.
 * @returns The engine (as a ref and as state), the canvas callbacks to pass to `CanvasMount`
 *   and the statistics.
 */
export function useMountedEngine(options: UseMountedEngineOptions): MountedEngineBinding {
  const { lastCanvasAction, activeTool = 'select', isMeasuringFrames = false } = options;
  const {
    canEdit = true,
    viewPreferences = DEFAULT_VIEW_PREFERENCES,
    themeName = 'light',
  } = options;
  const engineRef = useRef<MountedEngine | undefined>(undefined);
  const [engineState, setEngineState] = useState<MountedEngine | undefined>(undefined);
  const sizeRef = useRef<CanvasBackingSize | undefined>(undefined);
  const pendingRef = useRef<PendingEngine | undefined>(undefined);
  const generation = useRef(0);
  const latest = { ...options, activeTool, canEdit, isMeasuringFrames, viewPreferences };
  const latestRef = useRef(latest);
  useEffect(() => {
    latestRef.current = latest;
  });

  const onCanvasReady = useCallback(
    (canvas: HTMLCanvasElement) =>
      mountCanvasEngine(canvas, {
        latestRef,
        sizeRef,
        engineRef,
        pendingRef,
        generation,
        setEngineState,
      }),
    [],
  );

  const onCanvasResize = useCallback((size: CanvasBackingSize) => {
    sizeRef.current = size;
    if (engineRef.current !== undefined) engineRef.current.resize(size);
    else pendingRef.current?.resize(size);
    latestRef.current.hostCallbacks.onCanvasResize?.(size);
  }, []);

  useEffect(() => {
    engineRef.current?.setEditable(canEdit);
  }, [canEdit]);

  useEffect(() => {
    engineRef.current?.setActiveTool(activeTool);
  }, [activeTool]);

  useEngineAppearance(engineRef, themeName, options.whiteboardChrome ?? 'classic');

  const { isGridVisible, isSnappingOn, shouldDeleteConnectors } = viewPreferences;
  useEffect(() => {
    engineRef.current?.setViewPreferences({ isGridVisible, isSnappingOn, shouldDeleteConnectors });
  }, [isGridVisible, isSnappingOn, shouldDeleteConnectors]);

  const readFrameStats = useFrameStats(engineRef, isMeasuringFrames);
  const readFrameTimesMs = useCallback(
    (): readonly number[] => engineRef.current?.frameTimesMs() ?? [],
    [engineRef],
  );

  const handledSequenceRef = useRef(0);
  useEffect(() => {
    if (lastCanvasAction === undefined) return;
    if (lastCanvasAction.sequence <= handledSequenceRef.current) return;
    handledSequenceRef.current = lastCanvasAction.sequence;
    const { action } = lastCanvasAction;
    // The page before or after the one shown: the pages' to move between.
    const step = action.type === 'navigate' ? PAGE_STEPS[action.command] : undefined;
    if (step === undefined) engineRef.current?.runCanvasAction(action);
    else engineRef.current?.pages?.step(step);
  }, [lastCanvasAction]);

  return {
    engineRef,
    engine: engineState,
    onCanvasReady,
    onCanvasResize,
    readFrameStats,
    readFrameTimesMs,
  };
}
