import type { DocumentStore } from '@canvas/document';
import { screenToWorld, type Camera, type WorldBounds } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';
import {
  createPenSnapper,
  type SelectController,
  SNAPPING_OFF,
  type SnapSettings,
  type RootMovePreview,
  type ScreenPoint,
  type ToolCursor,
  type ToolId,
} from '@canvas/tools';

import { isEditingAction } from '../state/editing-actions.js';
import type { CanvasAction } from '../state/shell-action.js';

import { DocumentHitIndex } from './document-hit-index.js';
import { documentHitTester } from './document-hit-tester.js';
import { DocumentPanels, ignoreReport } from './document-panels.js';
import { DocumentSceneFeed, type SceneAttachSlicing } from './document-scene-feed.js';
import { connectorTargetUnder, DocumentTools, textUnder } from './document-tools.js';
import {
  loadBoardObjects,
  runArrangeCommand,
  runHistoryCommand,
  runSelectionCommand,
  type DocumentCommandContext,
} from './engine-document-commands.js';
import { createDocumentSelect } from './engine-document-select.js';
import type {
  EditHistory,
  EngineDocumentOptions,
  EngineDocumentView,
  EngineInspection,
} from './engine-document-types.js';
import { inspectEngineDocument } from './engine-inspection.js';
import { idleCoalesced } from './idle-coalesced.js';
import { isPanelAction } from './panel-actions.js';
import type { ScreenPointerInput } from './select-input-binding.js';
import { stickyUnder } from './sticky-under.js';
import { worldPointerOf } from './world-pointer.js';

export type {
  EditHistory,
  EngineDocumentOptions,
  EngineDocumentView,
  EngineInspection,
  TextEditingInspection,
} from './engine-document-types.js';

/** Page-owned document, tools, history and panels shared by main and worker renderers. */
export class EngineDocument {
  private readonly store: DocumentStore;
  private readonly history: EditHistory;
  private readonly controller: SelectController;
  /** The tool modes and the router between them and the select tool. */
  readonly tools: DocumentTools;
  /** The select tool as the clipboard side reads and selects through it. */
  readonly selectTool: Pick<
    SelectController,
    'selection' | 'isGesturing' | 'enteredGroupId' | 'select' | 'connectorPolicy'
  >;
  private readonly feed: DocumentSceneFeed;
  /** The hit-test index and its drawable gate, subscribed to the store before the select tool. */
  private readonly hits: DocumentHitIndex;
  /** Where the selection and arrange shortcuts run their commands. */
  private readonly commands: DocumentCommandContext;
  private readonly onChange: () => void;
  private readonly release: (() => void) | undefined;
  /** Shell board view, restyle/lock commands and creation-tool styles. */
  readonly panels: DocumentPanels;
  private view: EngineDocumentView | undefined;
  /** Where the pointer last was on the canvas, CSS px, for the resting cursor. */
  private lastScreen: ScreenPoint | undefined;
  private snapSettings: SnapSettings = SNAPPING_OFF;
  /** Whether the person may edit the board; the shell says, through `setEditable`. */
  private isEditable = true;

  private previewChanged(previewIds: readonly ObjectId[], movePreview?: RootMovePreview): void {
    this.view?.showMovePreview?.(movePreview);
    if (!movePreview || !this.view?.showMovePreview) this.feed.previewChanged(previewIds);
    this.view?.showOverlay(this.tools.overlay());
    this.panels.boardView.selectionChanged();
    this.tools.text.selectionChanged(); // a style preview shows the selection it was made on
    this.onChange();
  }

  /**
   * Follows the document and sets up the select tool over it.
   *
   * @param options - The document, history, origin, environment and change callback.
   */
  constructor(options: EngineDocumentOptions) {
    this.store = options.store;
    this.history = options.history;
    this.onChange = options.onChange;
    this.release = options.release;
    // First to follow the store, so the gate's verdicts are current when the select tool's
    // listener works out the selection frame.
    const hits = (this.hits = new DocumentHitIndex(this.store));
    const isDrawable = (id: ObjectId): boolean => hits.isDrawable(id);
    const documentSource = {
      get: (id: ObjectId) => hits.get(id), // Connectors placed: picked where they are drawn.
      childrenOf: (id: ObjectId) => this.store.references.childrenOf(id),
      isDrawable,
    };
    const { hitTester, paletteOf } = documentHitTester(hits, documentSource, this.store, options);
    const onCommandRefused = options.onCommandRefused ?? ignoreReport;
    // The whole board and the pages too; the hit index for objectsIn.
    this.panels = new DocumentPanels({ ...options, hits }, () => this.controller, onCommandRefused);
    this.selectTool = this.controller = createDocumentSelect(options, {
      store: this.store,
      hitTester,
      snapIndex: hits.index,
      isDrawable,
      canEdit: () => this.isEditable,
      canActivate: (id) => this.tools.router.canActivate(id),
      // Once per stepped run, not per part: it rebuilds the selection's overlay.
      onPreviewChange: idleCoalesced(this.store, this.previewChanged.bind(this)),
      onActivate: (activation) => {
        this.tools.router.activate(activation);
      },
      onCommandRefused,
    });
    this.tools = new DocumentTools({
      ...options,
      select: this.controller,
      textAt: (world, zoom) => textUnder(hitTester, this.store, world, zoom),
      stickyAt: (world, zoom) => stickyUnder(hitTester, this.store, world, zoom),
      textToolStyle: () => this.panels.toolStyle('text'),
      toolStyleOf: (tool) => this.panels.toolStyle(tool),
      snapIndex: hits.index,
      snapPoint: createPenSnapper(hits.index, documentSource),
      connectorTargetAt: (world, zoom) =>
        connectorTargetUnder(hits.index, documentSource, world, zoom, paletteOf),
      onPreviewChanged: (ids) => {
        this.feed.previewChanged(ids);
      },
      onChange: () => {
        this.view?.showOverlay(this.tools.overlay());
        this.onChange();
      },
    });
    const source = this.tools.sourceOver(this.controller.source);
    this.feed = new DocumentSceneFeed(this.store, source, hits, this.onChange, options.definitions);
    const { deletions } = this.panels; // A delete of a main with instances asks.
    this.commands = {
      ...options,
      controller: this.controller,
      deletions,
      canEdit: () => this.isEditable,
    };
  }

  /**
   * Starts drawing as `attach` does, a large document in slices.
   *
   * @param view - Where the scene and the overlay are drawn.
   * @param previousIds - Objects already drawn by an inert cached projection.
   * @param slicing - How to send a large document in slices.
   * @returns Resolves once the whole document is queued.
   */
  attach(
    view: EngineDocumentView,
    previousIds: readonly ObjectId[] | undefined,
    slicing: SceneAttachSlicing,
  ): Promise<void>;
  /**
   * Starts drawing: feeds the view the whole document, then every change, and the overlay's
   * model whenever it changes.
   *
   * @param view - Where the scene and the overlay are drawn.
   * @param previousIds - Objects already drawn by an inert cached projection.
   */
  attach(view: EngineDocumentView, previousIds?: readonly ObjectId[]): void;
  attach(
    view: EngineDocumentView,
    previousIds?: readonly ObjectId[],
    slicing?: SceneAttachSlicing,
  ): Promise<void> {
    this.view = view;
    view.showOverlay(this.tools.overlay());
    if (slicing !== undefined) return this.feed.attach(view, previousIds, slicing);
    this.feed.attach(view, previousIds);
    return Promise.resolve();
  }

  /**
   * Makes a tool the active one (`ToolRouter.setActiveTool`): its registered mode starts, or the
   * select tool takes primary-button input again; leaving the select tool cancels a drag.
   *
   * @param tool - The tool.
   */
  setActiveTool(tool: ToolId): void {
    this.tools.router.setActiveTool(tool);
    this.panels.runHeld();
  }

  /**
   * Whether the person may edit the board now.
   *
   * @returns What `setEditable` last said; true until it says otherwise.
   */
  get canEdit(): boolean {
    return this.isEditable;
  }

  /**
   * Turns editing on or off. Off, a gesture under way and any mode are dropped
   * writing nothing (`ToolRouter.abandonActiveMode`), back to the select tool, which then only selects (`SelectControllerOptions.canEdit`); no
   * mode starts, no editing canvas action runs (`refuses`) and the arrows pan.
   *
   * @param canEdit - Whether the person may edit.
   */
  setEditable(canEdit: boolean): void {
    if (canEdit === this.isEditable) return;
    // Nothing is committed once the person cannot edit: the mode is dropped, not ended.
    if (!canEdit) this.tools.router.abandonActiveMode();
    if (!canEdit) this.panels.dropHeld(); // Nor a panel action held during a press.
    this.isEditable = canEdit;
    this.view?.showOverlay(this.tools.overlay());
    this.onChange();
  }

  /**
   * Whether a canvas action is refused because the person cannot edit (`isEditingAction`,
   *): the check every canvas action passes before it runs, whoever dispatched it.
   *
   * @param action - The canvas action.
   * @returns True when it would edit and the person may not.
   */
  refuses(action: CanvasAction): boolean {
    return !this.isEditable && isEditingAction(action);
  }

  /**
   * Sets how drags snap (the person's preferences): to objects on screen while snapping is on, and
   * to the grid too while it shows.
   *
   * @param settings - Whether snapping is on and whether the grid shows.
   */
  setSnapping(settings: SnapSettings): void {
    this.snapSettings = settings;
  }

  /**
   * Feeds pointer input (a press, a held finger, a secondary click) to the active tool, else the
   * select tool, at the camera's view (`worldPointerOf`, its trail too); drags snap to the screen.
   *
   * @param input - The input, CSS px on the canvas.
   * @param camera - The camera now: to place the pointer, size handles and find the count badge.
   */
  handlePointer(input: ScreenPointerInput, camera: Camera): void {
    if (input.kind === 'pointerCancel' || input.kind === 'hold') {
      this.tools.router.handlePointer(input, camera.zoom);
    } else {
      this.lastScreen = input.screen;
      const pointer = worldPointerOf(input, camera);
      this.tools.router.handlePointer(pointer, camera.zoom, camera, this.snapSettings);
    }
    this.panels.runHeld(); // A panel action held during the press, once it ends.
  }

  /**
   * The cursor the active tool asks for: a mode's (the I-beam over text), the select tool's
   * (the rotate cursor, turned toward the pointer, over a selection's corner band and through a
   * rotation drag), or `default` while a tool without a mode is active.
   *
   * @returns The cursor.
   */
  cursor(): ToolCursor {
    return this.tools.router.cursor;
  }

  /**
   * Brings the select tool's resting cursor up to date after the camera moved under a still
   * pointer (a wheel zoom, a pan, a fit): the pointer's last canvas point is a new world point
   * and the bands' world size follows the zoom. Constant time; nothing before the first pointer
   * input or while another tool is active.
   *
   * @param camera - The camera now.
   */
  refreshCursor(camera: Camera): void {
    this.tools.router.followZoom(camera.zoom);
    if (this.lastScreen === undefined) return;
    this.tools.router.refreshCursor(screenToWorld(camera, this.lastScreen), camera);
  }

  /**
   * Acts on a shell action the document side owns: select all, deselect (Escape: cancels a drag
   * first, else leaves an entered group), delete, lock or unlock, the four order commands, align,
   * distribute and tidy up, group and ungroup, create component, undo and redo, the panels'
   * restyles, layout fields, row locks, tokens and component commands (`panels`), and an arrow-key
   * nudge while something is selected (with nothing selected the camera takes it). While the
   * person cannot edit, an editing action does nothing (`refuses`), and the arrows pan.
   *
   * @param action - The canvas action.
   * @param zoom - The camera zoom.
   * @returns Whether the action was handled here.
   */
  runCanvasAction(action: CanvasAction, zoom: number): boolean {
    // Refused for a viewer: taken, and nothing done.
    if (this.refuses(action)) return true;
    if (this.tools.runKey(action)) return true;
    if (isPanelAction(action)) {
      this.panels.runAction(action);
      return true;
    }
    switch (action.type) {
      case 'nudge':
        // A viewer's arrows always pan, as with nothing selected.
        if (!this.isEditable || this.controller.selection.ids.length === 0) return false;
        this.controller.handle(
          { kind: 'nudge', direction: action.direction, isLarge: action.isLarge },
          zoom,
        );
        return true;
      case 'selection': {
        const isTaken = runSelectionCommand(this.commands, action.command, zoom);
        // Escape can end a drag: a panel action held during it runs now.
        this.panels.runHeld();
        return isTaken;
      }
      case 'arrange':
        return runArrangeCommand(this.commands, action.command, zoom);
      case 'history':
        if (this.controller.isGesturing) return true;
        runHistoryCommand(this.history, action.command, this.commands.onNotice);
        return true;
      case 'component': // Going to a main leaves its zoom to the camera.
        return this.tools.previewPreset(action) ?? this.panels.runComponentAction(action);
      case 'reselectTool':
        this.tools.router.reselectTool(action.tool);
        return true;
      default:
        return false;
    }
  }

  /**
   * The selection's bounds, for zoom to selection.
   *
   * @returns The bounds, world units, or undefined when nothing is selected.
   */
  selectionBounds(): WorldBounds | undefined {
    return this.controller.selectionBounds();
  }

  /**
   * The bounds of everything on the board, for zoom to fit: the hit-test index's, which covers
   * every object with geometry, rotation and nesting included.
   *
   * @returns The bounds, world units, or undefined for an empty board.
   */
  contentBounds(): WorldBounds | undefined {
    return this.feed.hitIndex.bounds;
  }

  /**
   * Captures display objects.
   *
   * @returns Immutable source, absent during tool overrides.
   */
  captureProjectionSource(): ReturnType<DocumentSceneFeed['captureProjectionSource']> {
    return this.feed.captureProjectionSource();
  }

  /**
   * Reports the selection and the recent change sets, for the test harness.
   *
   * @returns The inspection.
   */
  inspect(): EngineInspection {
    const { store, controller } = this;
    const textEditing = this.tools.text.inspect();
    return inspectEngineDocument({ store, controller, feed: this.feed, textEditing });
  }

  /**
   * Writes the benchmark harness's synthetic board (`loadBoardObjects`).
   *
   * @param objects - The objects, parents before children.
   */
  load(objects: readonly BoardObject[]): void {
    loadBoardObjects(this.store, objects);
  }

  /** Stops following the document and showing it, and frees what the caller asked to. */
  destroy(): void {
    this.tools.destroy();
    this.panels.destroy();
    this.controller.destroy();
    this.feed.destroy();
    this.hits.destroy();
    this.view = undefined;
    this.release?.();
  }
}
