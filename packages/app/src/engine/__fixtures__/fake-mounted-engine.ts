// A MountedEngine that records what the shell asks of it, for shell and hook tests in jsdom,
// which has no GPU. The real mount is tested against a fake host in mount-engine-host*.test.ts
// and, in Chrome, by the scenario tests.
import { YjsDocumentStore, type DocumentStore, type NewObject } from '@canvas/document';
import type { BenchmarkSample, Camera, StickyAuthors } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import type { ToolId } from '@canvas/tools';

import type { CanvasBackingSize } from '../../canvas/backing-store-size.js';
import type { ClipboardFlavours } from '../../clipboard/clipboard-formats.js';
import type { PreparedCut } from '../../clipboard/clipboard-source.js';
import type { PasteTarget } from '../../clipboard/paste-handlers.js';
import type { PixelBlock, PixelRect } from '../../harness/canvas-harness.js';
import type { WhiteboardChrome } from '../../shell/whiteboard-chrome.js';
import type { CanvasAction } from '../../state/shell-action.js';
import type { ToolStyle } from '../../state/tool-style.js';
import type { ViewPreferences } from '../../state/view-preferences.js';
import type { ThemeName } from '../../theme/theme-tokens.js';
import { DocumentBoardView } from '../document-board-view.js';
import type { TextStyleChange } from '../document-text.js';
import type { EngineInspection } from '../engine-document.js';
import type {
  EngineDrawingBuffer,
  MountedEngine,
  MountEngine,
  MountEngineOptions,
} from '../mounted-engine.js';

/** The fake engine and everything done to it. */
export class FakeMountedEngine implements MountedEngine {
  readonly ready: Promise<void>;
  readonly canvas: HTMLCanvasElement;
  readonly options: MountEngineOptions;
  readonly actions: CanvasAction[] = [];
  readonly sizes: CanvasBackingSize[] = [];
  readonly captures: PixelRect[] = [];
  readonly activeTools: ToolId[] = [];
  /** The creation tools' styles the shell handed it, in order. */
  readonly toolStyles: [ToolId, ToolStyle][] = [];
  /** Every `setInkPicked` call, in order. */
  readonly inkPicks: [ToolId, boolean][] = [];
  /** The document the panels read: `options.store`, else an empty one. */
  readonly store: DocumentStore;
  /** The board view over it, with a selection the tests (and the panels) set. */
  readonly board: DocumentBoardView;
  /** The selected ids, primary first. */
  selectedIds: readonly ObjectId[] = [];
  readonly textStyleChanges: TextStyleChange[] = [];
  /** Every `setEditable` argument, in order. */
  readonly editable: boolean[] = [];
  /** Every `setViewPreferences` argument, in order. */
  readonly viewPreferences: ViewPreferences[] = [];
  /** Every `setTheme` argument, in order. */
  readonly themes: ThemeName[] = [];
  /** Every `setWhiteboardChrome` argument, in order. */
  readonly chromes: WhiteboardChrome[] = [];
  /** Every `setStickyAuthors` argument, in order. */
  readonly stickyAuthors: StickyAuthors[] = [];
  inspection: EngineInspection = {
    selectedIds: [],
    selectedObjects: [],
    changeSets: [],
    enteredGroupId: null,
  };
  /** What `copySelection` answers; undefined (nothing to copy) until a test sets it. */
  flavours: ClipboardFlavours | undefined;
  /** The message of each clipboard notice, as the mount's `onNotice` would show it. */
  readonly notices: string[] = [];
  /** The flavours of each cut whose delete ran. */
  readonly cuts: ClipboardFlavours[] = [];
  /** What each paste created, as `createObjects` listed it. */
  readonly pasted: (readonly NewObject[])[] = [];
  /** What `drawingBuffer` reports; undefined until a test sets it. */
  buffer: EngineDrawingBuffer | undefined;
  /** What `readFrameStats` answers; undefined makes it reject. */
  frameStats: BenchmarkSample | undefined;
  /** Whether frame statistics are recording. */
  isMeasuringFrames = false;
  /** What `frameTimesMs` answers; empty until a test sets it. */
  recentFrameTimesMs: readonly number[] = [];
  isDestroyed = false;
  currentCamera: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 1, viewportHeightPx: 1, dpr: 1 };

  constructor(canvas: HTMLCanvasElement, options: MountEngineOptions, ready: Promise<void>) {
    this.canvas = canvas;
    this.options = options;
    this.ready = ready;
    this.store = options.store ?? new YjsDocumentStore();
    this.board = new DocumentBoardView(this.store, {
      ids: () => this.selectedIds,
      select: (ids) => {
        this.selectedIds = [...ids];
      },
    });
  }

  /**
   * Selects ids as the select tool would, and tells the panels.
   *
   * @param ids - The ids, primary first.
   */
  select(ids: readonly ObjectId[]): void {
    this.board.select(ids);
  }

  camera(): Camera {
    return this.currentCamera;
  }

  resize(size: CanvasBackingSize): void {
    this.sizes.push(size);
  }

  setActiveTool(tool: ToolId): void {
    this.activeTools.push(tool);
  }

  setEditable(canEdit: boolean): void {
    this.editable.push(canEdit);
  }

  setViewPreferences(preferences: ViewPreferences): void {
    this.viewPreferences.push(preferences);
  }

  setTheme(themeName: ThemeName): void {
    this.themes.push(themeName);
  }

  setWhiteboardChrome(chrome: WhiteboardChrome): void {
    this.chromes.push(chrome);
  }

  setStickyAuthors(authors: StickyAuthors): void {
    this.stickyAuthors.push(authors);
  }

  setToolStyle(tool: ToolId, style: ToolStyle): void {
    this.toolStyles.push([tool, style]);
  }

  setInkPicked(tool: ToolId, isPicked: boolean): void {
    this.inkPicks.push([tool, isPicked]);
  }

  runCanvasAction(action: CanvasAction): void {
    this.actions.push(action);
  }

  applyTextStyle(change: TextStyleChange): void {
    this.textStyleChanges.push(change);
  }

  copySelection(): ClipboardFlavours | undefined {
    return this.flavours;
  }

  prepareCut(): PreparedCut {
    const { flavours } = this;
    if (flavours === undefined) return { kind: 'empty' };
    return { kind: 'ready', flavours, remove: () => void this.cuts.push(flavours) };
  }

  pasteTarget(): PasteTarget {
    return {
      notify: (notice: string) => {
        this.notices.push(notice);
        // As the real mount's paste target does: notices reach the shell through onNotice.
        this.options.onNotice?.(notice);
      },
      pointer: undefined,
      viewCentre: { x: 0, y: 0 },
      createObjects: (objects, onCreated) => {
        this.pasted.push(objects);
        onCreated?.(
          objects.map((object, index) => (object.id ?? `pasted-${String(index)}`) as ObjectId),
        );
        return true;
      },
    };
  }

  inspect(): EngineInspection {
    return this.inspection;
  }

  capturePixels(rect: PixelRect): Promise<PixelBlock> {
    this.captures.push(rect);
    const { widthPx, heightPx } = rect;
    return Promise.resolve({
      widthPx,
      heightPx,
      rgba: new Uint8ClampedArray(widthPx * heightPx * 4),
    });
  }

  drawingBuffer(): EngineDrawingBuffer | undefined {
    return this.buffer;
  }

  startFrameStats(): void {
    this.isMeasuringFrames = true;
  }

  readFrameStats(): Promise<BenchmarkSample> {
    return this.frameStats === undefined
      ? Promise.reject(new Error('No frame statistics.'))
      : Promise.resolve(this.frameStats);
  }

  stopFrameStats(): void {
    this.isMeasuringFrames = false;
  }

  frameTimesMs(): readonly number[] {
    return this.recentFrameTimesMs;
  }

  destroy(): void {
    this.isDestroyed = true;
    this.board.destroy();
  }
}

/**
 * A mount function that creates fake engines and keeps them.
 *
 * @param ready - What each engine's `ready` settles to; resolved by default.
 * @param store - The document every engine shows; a new empty one each if absent.
 * @returns The mount and the engines it created, oldest first.
 */
export function createFakeMount(
  ready: () => Promise<void> = () => Promise.resolve(),
  store?: DocumentStore,
): {
  mount: MountEngine;
  engines: FakeMountedEngine[];
} {
  const engines: FakeMountedEngine[] = [];
  const mount: MountEngine = (canvas, options = {}) => {
    const withStore = store === undefined ? options : { ...options, store };
    const engine = new FakeMountedEngine(canvas, withStore, ready());
    engines.push(engine);
    return engine;
  };
  return { mount, engines };
}
