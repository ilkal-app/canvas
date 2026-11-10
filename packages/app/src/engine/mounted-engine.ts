import type { DocumentStore, OperatedWriters, TransactionOrigin } from '@canvas/document';
import type {
  BenchmarkSample,
  Camera,
  SearchHighlightModel,
  StickyAuthors,
  TraceTintModel,
} from '@canvas/engine';
import type { BoardObject } from '@canvas/schema';
import type { TextLayoutService, ToolId } from '@canvas/tools';

import type { PageImages } from '../assets/page-images.js';
import type { CanvasBackingSize } from '../canvas/backing-store-size.js';
import type { ClipboardFlavours } from '../clipboard/clipboard-formats.js';
import type { PreparedCut } from '../clipboard/clipboard-source.js';
import type { PasteTarget } from '../clipboard/paste-handlers.js';
import type { HostFrameFeed } from '../diagnostics/ink-debug/host-frame-feed.js';
import type { OverlayLabelFeed } from '../editing/overlay-label-feed.js';
import type { PixelBlock, PixelRect } from '../harness/canvas-harness.js';
import type { LiveInkChannel } from '../live-ink/live-ink-channel.js';
import type { NoticeSink } from '../notices/notice-outline.js';
import type { PageNavigation } from '../pages/page-navigator.js';
import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';
import type { CanvasAction } from '../state/shell-action.js';
import type { ToolStyle } from '../state/tool-style.js';
import type { ViewPreferences } from '../state/view-preferences.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import type { BoardView } from './board-view.js';
import type { TextStyleChange, TextStyleContext } from './document-text.js';
import type { EditHistory, EngineInspection } from './engine-document.js';
import type { PeerEditingSurface } from './mount-peer-editing.js';
import type { PeerSelectionSurface } from './mount-peer-selection.js';

/** The canvas's drawing buffer as the engine last drew into it. */
export interface EngineDrawingBuffer {
  /** Width, device px. */
  readonly widthPx: number;
  /** Height, device px. */
  readonly heightPx: number;
  /** Device pixels per CSS pixel, as the frame's camera had it. */
  readonly dpr: number;
}

/**
 * The engine as the shell sees it once mounted on the canvas: the camera, resizes, the active
 * tool, the canvas actions (camera, selection, history), pixel capture, the drawing buffer and
 * inspection for the test harness, frame statistics for the developer overlay, and teardown.
 * The engine host mount (`createEngineHostMount`: the shell's default, in a worker or on
 * the main thread) implements it; test doubles do too.
 */
export interface MountedEngine {
  /** Optional current-frame display sidecar; refuses tool previews and unsupported resources. */
  prepareSnapshotPreview?(boardId: string): Promise<Uint8Array | undefined>;
  /**
   * Settles once the GPU backend runs and the first frame is drawn, or the mount was torn down
   * first; rejects when no backend can start (neither WebGPU nor WebGL2).
   */
  readonly ready: Promise<void>;
  /**
   * The board as the shell's panels see it (the style and layers panels): the document, the
   * selection and their changes, on the page from the moment the engine mounts.
   */
  readonly board: BoardView;
  /** The board's pages: the page shown and the page commands; absent in fakes. */
  readonly pages?: PageNavigation;
  /**
   * The labels of the editing states the overlay shows (the size readout, gap lengths,
   * the locked notice), which the shell draws over the canvas; none if absent.
   */
  readonly overlayLabels?: OverlayLabelFeed;
  /**
   * The camera the canvas shows now, mid-animation included.
   *
   * @returns The camera.
   */
  camera(): Camera;
  /**
   * Shows a camera at once (a page's own; a followed person's view), never
   * reported as the person's camera input. Absent from an engine that cannot.
   *
   * @param camera - The camera.
   */
  jumpCamera?(camera: Camera): void;
  /**
   * Follows a canvas resize: keeps the world point at the top-left corner and the zoom, takes
   * the new size and device pixel ratio, and redraws.
   *
   * @param size - The canvas's new CSS and drawing buffer size.
   */
  resize(size: CanvasBackingSize): void;
  /**
   * Makes a toolbar tool the active one: primary-button input on the canvas selects and
   * transforms only while the select tool is active.
   *
   * @param tool - The tool the shell shows as pressed.
   */
  setActiveTool(tool: ToolId): void;
  /**
   * Turns editing on or off for the person (the shell's `canEdit`, from the board's
   * connection): off, the canvas only looks: the select tool selects without handles or
   * transforms, no mode starts, no editing canvas action runs, drops and pastes add nothing and
   * the text panel restyles nothing. Editable until told otherwise.
   *
   * @param canEdit - Whether the person may edit.
   */
  setEditable(canEdit: boolean): void;
  /**
   * Applies the person's view preferences: shows or
   * hides the dot grid, and turns the select tool's snapping on or off (to the grid only while
   * it shows). Before the engine runs, it applies them as soon as it does.
   *
   * @param preferences - Whether the grid shows and whether drags snap.
   */
  setViewPreferences(preferences: ViewPreferences): void;
  /**
   * Sets the viewer's theme: the engine redraws objects' theme-aware `ink` in it (the
   * themes' `--color-ink`, `inkColorsOfThemes`), writing nothing to the document, and new strokes
   * and text take their default colour against its canvas.
   *
   * @param themeName - The theme shown now.
   */
  setTheme(themeName: ThemeName): void;
  /**
   * Sets the shell's chrome: the selection overlay shows again in the whiteboard design's
   * selection under `floating`, in the classic one under `classic`.
   *
   * @param chrome - The chrome shown now.
   */
  setWhiteboardChrome(chrome: WhiteboardChrome): void;
  /**
   * Tells the engine who wrote each sticky (`useStickyAuthors`): the board's "Show
   * authors on stickies" setting with the members' names; kept for a host shown later.
   *
   * @param authors - Whether authors show, the members' names and the fallback.
   */
  setStickyAuthors(authors: StickyAuthors): void;
  /**
   * Sets the style a creation tool gives new objects (its registered defaults with the
   * person's choices from the style panel over them, `resolveToolStyles`), for the tool's mode to
   * read from the document side (`EngineDocument.panels.toolStyle`).
   *
   * @param tool - The creation tool.
   * @param style - Its style.
   */
  setToolStyle(tool: ToolId, style: ToolStyle): void;
  /**
   * Sets whether the `ink` a creation tool creates with is the person's own pick
   * (`ShellState.pickedInk`), which new objects keep rather than taking a contrasting colour
   * over an object.
   *
   * @param tool - The creation tool.
   * @param isPicked - Whether its `ink` was picked.
   */
  setInkPicked(tool: ToolId, isPicked: boolean): void;
  /**
   * Acts on a shell action: the camera's zoom and fit shortcuts, the selection's commands
   * (select all, deselect, delete), undo and redo, and the arrow keys, which nudge the
   * selection or, with nothing selected, pan the view; others are ignored.
   *
   * @param action - The canvas action the shell recorded.
   */
  runCanvasAction(action: CanvasAction): void;
  /**
   * The selection as clipboard flavours, for the shell's clipboard router: the objects
   * with their descendants as a portable board, their texts, and styled HTML.
   *
   * @returns The flavours, or `undefined` when nothing selected can be copied.
   */
  copySelection(): ClipboardFlavours | undefined;
  /**
   * Prepares a cut of the selection for the clipboard router: its flavours, and the delete of
   * the copied objects to run once they are written; refused when a selected object is locked.
   *
   * @returns The prepared cut.
   */
  prepareCut(): PreparedCut;
  /**
   * Where a paste goes now: the pointer on the board (none while it is off the canvas), the
   * view's centre, the local user's `createObjects`, which selects what it creates, and `notify`,
   * which shows a clipboard notice through the mount's `onNotice`.
   *
   * @returns The target.
   */
  pasteTarget(): PasteTarget;
  /**
   * Reports the selection and the document's recent change sets, for the test harness.
   *
   * @returns Plain data.
   */
  inspect(): EngineInspection;
  /**
   * Reads a rectangle of the canvas from inside the engine frame: the engine's next frame
   * captures it after `submit`, in the task that drew it.
   *
   * @param rect - The rectangle, device px of the drawing buffer.
   * @returns The pixels, RGBA8, straight alpha, top row first.
   * @throws {RangeError} When the rectangle is not whole pixels inside the drawing buffer
   *   (as a rejection).
   * @throws {Error} When the engine could not start or was torn down (as a rejection).
   */
  capturePixels(rect: PixelRect): Promise<PixelBlock>;
  /**
   * The drawing buffer the engine last drew into, and the ratio its camera had, where the
   * engine runs: after a canvas hands its drawing to a worker the element keeps its hand-over
   * `width` and `height`, so the test harness reads the size from here.
   *
   * @returns The buffer, or undefined before the first frame.
   */
  drawingBuffer(): EngineDrawingBuffer | undefined;
  /**
   * Starts recording frame statistics for the developer overlay (the frame rate is always
   * measured): stage timers where the engine renders, as a new run; frames pay nothing for them
   * until then. Before the engine runs, it starts them as soon as it does.
   */
  startFrameStats(): void;
  /**
   * Reads the statistics of the frames since they started: CPU per stage, GPU per pass, the
   * per-frame counters and GPU memory (from a worker, one message each way; the overlay reads
   * at 4 Hz).
   *
   * @returns The summary, plain data; rejects while statistics are not started, before the
   *   engine runs, or after it is torn down.
   */
  readFrameStats(): Promise<BenchmarkSample>;
  /** Stops recording frame statistics and removes the stage timers. */
  stopFrameStats(): void;
  /**
   * Recent frame timestamps, for the developer overlay's frames-per-second figures
   * (`frameRateOf`): the engine's own frames (`EngineFrameReport.frameTimeMs`), not the page's
   * `requestAnimationFrame`, so this is right wherever the engine runs and costs nothing beyond
   * what `onFrame` already delivers. Kept whether or not frame statistics are recording.
   *
   * @returns Timestamps within the last `FRAME_RATE_WINDOW_MS`, oldest first; empty before the
   *   first frame.
   */
  frameTimesMs(): readonly number[];
  /**
   * The engine's frame reports, with its host and backend, for the ink latency readout
   * (`?inkdebug=1`). Absent from mounts without a host.
   */
  readonly hostFrames?: HostFrameFeed;
  /**
   * The draw tool's live ink: the stroke under way, which the page's live ink overlay
   * draws while it listens. Absent from mounts without a host.
   */
  readonly liveInk?: LiveInkChannel;
  /**
   * Shows the trace sheets' tint over the board: the sheets the shell's trace sheets
   * hold, drawn by the engine's trace tint layer; `EMPTY_TRACE_TINT` hides it. Before the engine
   * runs, it shows the latest model as soon as it does. Mounts without the layer leave it out.
   *
   * @param model - The open sheets, world units.
   */
  showTraceTint?(model: TraceTintModel): void;
  /**
   * Shows the board search highlight: the objects the search sheet found, outlined by
   * the engine's highlight layer; `EMPTY_SEARCH_HIGHLIGHT` hides it. Mounts without the layer
   * leave it out.
   *
   * @param model - The objects found, world units, and the person's colour.
   */
  showSearchHighlights?(model: SearchHighlightModel): void;
  /**
   * Peers editing text, drawn over the board, and where the person edits text, for presence.
   * Mounts without it show no peer editing and share none.
   */
  readonly peerEditing?: PeerEditingSurface;
  /**
   * Peers' selections, outlined over the board in their colours (item 14). Mounts
   * without it show none.
   */
  readonly peerSelection?: PeerSelectionSurface;
  /**
   * Applies a style change from the panel to the targeted text.
   *
   * @param change - The change.
   */
  applyTextStyle?(change: TextStyleChange): void;
  /** Removes the input listeners, stops the frame loop and frees the GPU resources. */
  destroy(): void;
}

/**
 * Where the canvas asks the shell to open its context menu: the press
 * of a long-press or a secondary click, CSS px in the page's viewport.
 */
export interface ContextMenuRequest {
  /** From the viewport's left edge, CSS px (as `MouseEvent.clientX`). */
  readonly clientX: number;
  /** From the viewport's top edge, CSS px (as `MouseEvent.clientY`). */
  readonly clientY: number;
  /** Whether a finger's long-press asked, not a secondary click; false if absent. */
  readonly isTouch?: boolean;
}

/** What a mount may be given besides the canvas; tests inject the size and the motion query. */
export interface MountEngineOptions {
  /** Current person preferences available before an optional preview is revealed. */
  readonly initialViewPreferences?: ViewPreferences;
  /** The viewer's theme when the engine mounts (`setTheme` changes it); light if absent. */
  readonly initialTheme?: ThemeName;
  /**
   * The shell's chrome when the engine mounts (`setWhiteboardChrome` changes it): under `floating`
   * the selection overlay draws the whiteboard design's selection (`overlayPaletteOf`);
   * classic if absent.
   */
  readonly whiteboardChrome?: WhiteboardChrome;
  /** The canvas's size when it mounts; measured from the canvas if absent. */
  readonly viewport?: CanvasBackingSize;
  /**
   * The document to show and edit; if absent, a new one holding `board` (`createDemoDocument`)
   * until documents come from the relay.
   */
  readonly store?: DocumentStore;
  /** The board a new document starts with when no `store` is given; the demo board if absent. */
  readonly board?: readonly BoardObject[];
  /** The local user's undo history; `createHistory` over the store for `origin` if absent. */
  readonly history?: EditHistory;
  /**
   * Which Yjs client ids write for agents the person operates (`operatedWritersOf`):
   * the history made for `origin` records their remote changes as the person's, so Cmd+Z undoes
   * them. Unused when `history` is given; none recorded if absent.
   */
  readonly operatedWriters?: OperatedWriters;
  /** Who the tools' commands are attributed to; `LOCAL_USER_ORIGIN` if absent. */
  readonly origin?: TransactionOrigin;
  /** Whether to jump instead of animating fits; default the `prefers-reduced-motion` query. */
  readonly prefersReducedMotion?: () => boolean;
  /**
   * Receives what goes wrong after the engine started (a frame that throws, a worker that
   * crashes), in a worker or on the main thread alike; the page's `reportError` if absent. A
   * start that fails rejects `ready` instead.
   */
  readonly onFault?: (error: Error) => void;
  /**
   * Receives a short sentence for the shell to show when a canvas action does nothing and the
   * person should know why (grouping objects with different parents; objects an order
   * command left where they were), what the clipboard could not do (a cut of a locked
   * object, a paste over the limits), or that the document refused a command the person
   * asked for (a select tool gesture's, a style panel's restyle: `refusalNotice`); for an undo
   * or redo another person's change kept from changing anything, who and what.
   */
  readonly onNotice?: NoticeSink;
  /**
   * Called when the active tool changes from inside the canvas: a tool mode finished and handed
   * back to `select`, or activating an object started its tool's mode (a double-click on text).
   * The shell makes its toolbar follow.
   */
  readonly onToolChange?: (tool: ToolId) => void;
  /**
   * Lays text out on the page for the text tool, with the faces the engine draws with; the
   * engine host mount loads the app's fonts (`loadPageFonts`) when absent.
   */
  readonly textLayout?: TextLayoutService;
  /**
   * Called when the style the text section of the style panel shows changes: text edited or
   * selected, a caret move, a restyle. The engine host mount calls it; others do not.
   */
  readonly onTextStyleChange?: (context: TextStyleContext | undefined) => void;
  /**
   * Opens the shell's context menu: the select tool asks for it on a long-press or a secondary
   * click on the canvas, once the selection holds what was pressed. Nothing opens if absent.
   */
  readonly onContextMenu?: (request: ContextMenuRequest) => void;
  /**
   * Called with the camera the canvas shows whenever it may have changed (a pan, a zoom, a fit,
   * a resize), for the zoom control's percentage. The engine host mount calls it.
   */
  readonly onCameraChange?: (camera: Camera) => void;
  /**
   * Called when the person moves the camera themselves (a wheel, a pinch, a drag-pan, a zoom key
   * or control), never for a camera the app sets: following someone stops on it.
   */
  readonly onCameraInput?: () => void;
  /**
   * The page's images: the board's assets service and tokens, which the engine's asset
   * adapter reaches over an app-owned port, and the uploads of dropped, pasted and picked images.
   * Without it, images draw the fallback (the harness's, or placeholders) and cannot be added.
   */
  readonly images?: PageImages;
}

/**
 * Mounts the engine on a canvas and returns it running. The shell calls exactly one such
 * function: by default the engine host mount (`createEngineHostMount`), with the engine
 * in a worker where the browser can render there, else on the main thread behind the same host
 * interface (`mountDefaultEngine` chooses).
 */
export type MountEngine = (
  canvas: HTMLCanvasElement,
  options?: MountEngineOptions,
) => MountedEngine;
