import { useEffect, useMemo, useRef, useState } from 'react';

import type { PresenceSnapshot } from '@canvas/collab';

import type { CanvasMountProps } from '../canvas/canvas-mount.js';
import { createCameraSource, type CameraSource } from '../editing/camera-source.js';
import type { TextStyleContext } from '../engine/document-text.js';
import type { MountEngine } from '../engine/mounted-engine.js';
import { useEngineToolStyles } from '../hooks/use-engine-tool-styles.js';
import {
  useMountedEngine,
  type MountedEngineBinding,
  type UseMountedEngineOptions,
} from '../hooks/use-mounted-engine.js';
import { useNotice, type NoticeBinding } from '../hooks/use-notice.js';
import { noticeOf } from '../notices/notice-outline.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import { resolveToolStyles, type ToolStyles } from '../state/tool-style.js';
import type { ThemeName } from '../theme/theme-tokens.js';
import { DEFAULT_TOOL_STYLES } from '../tool-styles/default-tool-styles.js';
import { createZoomSource, type ZoomSource } from '../toolbar/zoom-source.js';

import {
  useCreationToolClearsSelection,
  type CreationToolSelection,
} from './use-creation-tool-clears-selection.js';
import { useWhiteboardChrome } from './whiteboard-chrome.js';

/** The engine as the shell runs it, and what the shell hands it besides actions. */
export interface ShellEngine {
  /** The mounted engine's binding: the engine, the canvas callbacks, the frame statistics. */
  readonly engine: MountedEngineBinding;
  /** Each creation tool's style: its registered defaults with the person's choices over them. */
  readonly toolStyles: ToolStyles;
  /** The shell's one notice, which every sentence the engine has for the person reaches. */
  readonly notice: NoticeBinding;
  /**
   * The text style the engine last reported (`onTextStyleChange`): what the style panel's text
   * section shows, or undefined while no text is targeted.
   */
  readonly textStyle: TextStyleContext | undefined;
  /** The camera's zoom as the engine last showed it, for the zoom control. */
  readonly zoom: ZoomSource;
  /**
   * The camera as the engine last showed it, for the text bar and the editing labels over the
   * canvas.
   */
  readonly camera: CameraSource;
}

/** What {@link useShellEngine} runs the engine with. */
export interface UseShellEngineOptions {
  /** Mounts the engine on the canvas. */
  readonly mount: MountEngine;
  /** Optional preview startup that resolves only after the live handoff. */
  readonly startEngine?: UseMountedEngineOptions['startEngine'];
  /** The shell state: the canvas actions, the tool, the overlay, the view preferences. */
  readonly state: ShellState;
  /** The host's canvas callbacks. */
  readonly hostCallbacks: CanvasMountProps;
  /** Receives the error when the engine cannot start, and its faults. */
  readonly onError: (error: unknown) => void;
  /**
   * The board the engine edits and who edits are attributed to; the demo document if absent.
   * Where it has presence (`BoardConnection.remotePresence`), an undo another person's change
   * kept names whom the relay vouches for.
   */
  readonly document?: UseMountedEngineOptions['document'] & {
    readonly remotePresence?: () => PresenceSnapshot;
  };
  /**
   * The shell's reducer dispatch: the tool the canvas makes active (a tool mode that finished,
   * an activated object's mode) is selected through it, so the toolbar follows.
   */
  readonly dispatch: (action: ShellAction) => void;
  /** Opens the shell's context menu where the canvas asks; nothing opens if absent. */
  readonly onContextMenu?: UseMountedEngineOptions['onContextMenu'];
  /** Told when the person moves the camera themselves (a follow stops on it). */
  readonly onCameraInput?: () => void;
  /** The theme shown: the engine draws objects' `ink` in it; light if absent. */
  readonly themeName?: ThemeName;
}

/**
 * Runs the engine for the shell (`useMountedEngine`): hands it the canvas actions, the active
 * tool, whether frame statistics record, the person's view preferences (grid and snapping) and
 * each creation tool's style (`useEngineToolStyles`), and shows what it tells the person (why
 * an action did nothing, a refused command, objects an order command left out, what the
 * clipboard could not do) in the shell's one notice (`useNotice`, through the mount's
 * `onNotice`; an undo another person's change kept outlines what they changed, and names them
 * when the relay vouches for one present person, `noticeOf`), and keeps the text style the engine reports for the style panel's text section
 * and the text bar, the zoom it shows for the zoom control and the camera for the editing
 * layers over the canvas.
 *
 * @param options - The mount, the shell state, the host's callbacks, where errors and context
 *   menu requests go, and the board to edit.
 * @returns The engine binding, the tools' styles and the notice.
 */
export function useShellEngine(options: UseShellEngineOptions): ShellEngine {
  const { state, document } = options;
  const { isGridVisible, isSnappingOn, shouldDeleteConnectors } = state;
  const notice = useNotice(state.lastCanvasAction?.sequence);
  const [textStyle, setTextStyle] = useState<TextStyleContext | undefined>(undefined);
  const [zoom] = useState(createZoomSource);
  const [camera] = useState(createCameraSource);
  // The engine mounts with the shell's chrome: the floating one draws the design's selection.
  const whiteboardChrome = useWhiteboardChrome();
  // Its own switches are told apart from the person's, which clear the selection.
  const engineTools = useRef<CreationToolSelection | undefined>(undefined);
  const engine = useMountedEngine({
    mount: options.mount,
    ...(options.startEngine === undefined ? {} : { startEngine: options.startEngine }),
    lastCanvasAction: state.lastCanvasAction,
    hostCallbacks: options.hostCallbacks,
    onError: options.onError,
    activeTool: state.activeTool,
    canEdit: state.canEdit,
    isMeasuringFrames: state.isDeveloperOverlayOpen,
    onNotice: (message, protectedUndo) => {
      const shown = noticeOf(message, protectedUndo, document?.remotePresence?.());
      notice.show(shown.message, undefined, shown.outline);
    },
    onToolChange: (tool) => {
      engineTools.current?.noteEngineTool(tool);
      options.dispatch({ type: 'selectTool', tool });
    },
    onTextStyleChange: setTextStyle,
    onCameraChange: (shown) => {
      zoom.write(shown.zoom);
      camera.write(shown);
    },
    viewPreferences: { isGridVisible, isSnappingOn, shouldDeleteConnectors },
    ...(options.themeName === undefined ? {} : { themeName: options.themeName }),
    whiteboardChrome,
    ...(document === undefined ? {} : { document }),
    ...(options.onContextMenu === undefined ? {} : { onContextMenu: options.onContextMenu }),
    ...(options.onCameraInput === undefined ? {} : { onCameraInput: options.onCameraInput }),
  });
  const toolStyles = useMemo(
    () => resolveToolStyles(DEFAULT_TOOL_STYLES, state.toolStyles),
    [state.toolStyles],
  );
  useEngineToolStyles(engine.engine, toolStyles, state.pickedInk);
  const mounted = engine.engine;
  engineTools.current = useCreationToolClearsSelection(mounted, state.activeTool, whiteboardChrome);
  useEffect(() => {
    if (mounted === undefined) return;
    zoom.write(mounted.camera().zoom);
    camera.write(mounted.camera());
  }, [mounted, zoom, camera]);
  return { engine, toolStyles, notice, textStyle, zoom, camera };
}
