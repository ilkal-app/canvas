import type {
  CommandEnvironment,
  CommandError,
  DocumentStore,
  StylePatch,
  TransactionOrigin,
} from '@canvas/document';
import {
  hitPoint,
  type HitPointOptions,
  type SceneSource,
  type SpatialSearch,
} from '@canvas/engine';
import { presetKey, type BoardObject, type ObjectId, type Point } from '@canvas/schema';
import {
  fillCropModeOf,
  isTextBoxObject,
  orientedBoxOf,
  type SelectController,
  type SelectHitTester,
  type SelectionOverlayModel,
  type SnapIndex,
  type TextLayoutService,
  type ToolId,
  type ToolKeyInput,
} from '@canvas/tools';

import { OverlayLabelFeed } from '../editing/overlay-label-feed.js';
import type { CanvasAction, ComponentAction } from '../state/shell-action.js';
import type { ToolStyle } from '../state/tool-style.js';

import type { PreviewedSource } from './document-scene-feed.js';
import { DocumentText } from './document-text.js';
import { cropContextOf } from './modes/image-mode.js';
import type { ToolModeServices } from './modes/tool-mode-entry.js';
import { registerToolModes } from './modes/tool-modes.js';
import { presetPreviewObjects, type PresetPreview } from './preset-preview.js';
import { isTextToggle } from './text-style-types.js';
import { ToolRouter } from './tool-router.js';
import type { CapturingHistory } from './typing-undo-policy.js';

/** What {@link DocumentTools} routes between and reports to. */
export interface DocumentToolsOptions {
  /** The document the tools edit. */
  readonly store: DocumentStore;
  /** Who the tools' commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** The local user's history, whose steps typing groups. */
  readonly history: CapturingHistory;
  /** The select tool, active whenever no mode is. */
  readonly select: SelectController;
  /** Lays text out on the page; none (no fonts) when absent. */
  readonly textLayout?: TextLayoutService | undefined;
  /** The editable text object under a point, for the text tool. */
  readonly textAt: (world: Point, zoom: number) => ObjectId | undefined;
  /** Called with objects whose preview changed, so the scene redraws them. */
  readonly onPreviewChanged: (ids: readonly ObjectId[]) => void;
  /** Called when what the tools show changed (a mode's overlay or cursor, a mode ending). */
  readonly onChange: () => void;
  /** Called when the canvas changes the active tool, so the shell's toolbar follows. */
  readonly onToolChange?: ((tool: ToolId) => void) | undefined;
  /** Receives a sentence for the person (editing ended because the text was locked). */
  readonly onNotice?: ((message: string) => void) | undefined;
  /** The text tool's style, which new text starts in. */
  readonly textToolStyle?: (() => StylePatch) | undefined;
  /** Each creation tool's style, which the tool modes create objects in (the sticky tool's). */
  readonly toolStyleOf?: ((tool: ToolId) => ToolStyle) | undefined;
  /** Snaps a pen point to what is on screen and the grid; no snapping when absent. */
  readonly snapPoint?: ToolModeServices['snapPoint'];
  /** Receives the errors of an edit the document refused (text locked meanwhile). */
  readonly onCommandRefused?: ((errors: readonly CommandError[]) => void) | undefined;
  /** The hit-test index, which line ends snap to anchors through. */
  readonly snapIndex?: SnapIndex | undefined;
  /** The object a connector end attaches to under a point (`connectorTargetUnder`). */
  readonly connectorTargetAt: NonNullable<ToolModeServices['connectorTargetAt']>;
  /** The sticky note under a point, inside groups too (`stickyUnder`). */
  readonly stickyAt?: ToolModeServices['stickyAt'];
  /** Opens the image tool's file picker; the image tool says there are no images when absent. */
  readonly pickImages?: ToolModeServices['pickImages'];
  /** Pans the view for the hand tool; the hand pans nothing when absent. */
  readonly panView?: ToolModeServices['panView'];
  /** The view's centre, where the sticky tool's Enter places a note. */
  readonly viewCentre?: ToolModeServices['viewCentre'];
  /** The page's live ink overlay, for the draw tool's stroke under way. */
  readonly liveInk?: ToolModeServices['liveInk'];
  /** The viewer's theme and canvas, for the default colour of a new stroke or text. */
  readonly creationInk?: ToolModeServices['creationInk'];
}

/**
 * The editable text a press lands on, for the text tool: the select tool's hit, when it is a
 * text object's or a sticky note's own geometry (a grouped one selects its group, so is not
 * edited from here).
 *
 * @param hitTester - The select tool's hit tester.
 * @param store - The document.
 * @param world - The press, world units.
 * @param zoom - The camera zoom.
 * @returns The text object's id, or undefined.
 */
export function textUnder(
  hitTester: SelectHitTester,
  store: DocumentStore,
  world: Point,
  zoom: number,
): ObjectId | undefined {
  const hit = hitTester.hitPoint(world, zoom);
  return hit?.part === 'object' && isTextBoxObject(store.get(hit.id)) ? hit.id : undefined;
}

/**
 * The object a connector end attaches to under a point when no anchor is near: the
 * topmost object hit there (the engine's `hitPoint`, the select tool's stroke tolerance), not a
 * connector or a comment (a connector attaches to neither) and not a frame, whose open area is
 * board to draw on (a frame is attached to by its anchors). A grouped object is attached to
 * itself, not its group.
 *
 * @param index - The hit-test index.
 * @param source - The document as the index holds it (connectors placed).
 * @param world - The point, world units.
 * @param zoom - The camera zoom.
 * @param paletteOf - What an object's colour tokens resolve in (`documentHitTester`).
 * @returns The object's id, or undefined.
 */
export function connectorTargetUnder(
  index: SpatialSearch,
  source: SceneSource,
  world: Point,
  zoom: number,
  paletteOf?: HitPointOptions['paletteOf'],
): ObjectId | undefined {
  return hitPoint(index, source, world, { zoom, ...(paletteOf && { paletteOf }) }).find((id) => {
    const type = source.get(id)?.type;
    return type !== 'connector' && type !== 'comment' && type !== 'frame';
  });
}

/** A layout service for a page with no fonts: nothing lays out. */
const NO_TEXT_LAYOUT: TextLayoutService = { layout: () => undefined };

/**
 * The key a canvas action is to a tool mode, if it is one a mode can take.
 *
 * @param action - The canvas action.
 * @returns The key, or undefined.
 */
export function toolKeyOf(action: CanvasAction): ToolKeyInput | undefined {
  if (action.type === 'nudge') {
    return { kind: 'nudge', direction: action.direction, isLarge: action.isLarge };
  }
  if (action.type !== 'selection') return undefined;
  switch (action.command) {
    case 'deselect':
      return { kind: 'escape' };
    case 'delete':
      return { kind: 'delete' };
    case 'deleteAndHeal':
      return { kind: 'delete', isHealing: true };
    case 'selectAll':
      return { kind: 'selectAll' };
    case 'activate':
      return { kind: 'enter' };
    default:
      return undefined;
  }
}

/**
 * The engine document's tool modes: the `ToolRouter` over
 * the select tool and every mode of `modes/` (`TOOL_MODES`, registered with the services
 * `DocumentText` gives), the canvas
 * keys a mode takes before the select tool, the objects a mode previews without writing (a
 * composition), laid over the select tool's source, and the overlay the select tool and the
 * active mode show together. Kept apart from `EngineDocument`, which wires it in. Main thread.
 */
export class DocumentTools {
  /** Routes input to the active tool mode, or to the select tool. */
  readonly router: ToolRouter;
  /** Text: the text tool, text activation and text styling. */
  readonly text: DocumentText;
  private readonly previews = new Map<ObjectId, BoardObject>();
  /** The ids the Variants section's preset preview holds in `previews`. */
  private presetPreviewIds: readonly ObjectId[] = [];
  /** The stored objects the preset preview hides: out of the scene while it shows. */
  private presetHiddenIds: ReadonlySet<ObjectId> = new Set();
  /** The page shown, whose mains a preset preview reads. */
  private readonly store: DocumentStore;
  /** Tells the scene which previewed objects changed. */
  private readonly onPreviewChanged: (ids: readonly ObjectId[]) => void;
  private readonly modeServices: ToolModeServices;
  /** Tells the engine document that what the tools show changed. */
  private readonly onChange: () => void;
  /** The labels of the overlay last shown, for the shell's label layer. */
  readonly labels = new OverlayLabelFeed();

  /**
   * Starts with the select tool active and every tool mode registered.
   *
   * @param options - The document, the select tool, text layout and the callbacks.
   */
  constructor(options: DocumentToolsOptions) {
    const { store, select, onChange, onToolChange } = options;
    this.onChange = onChange;
    this.onPreviewChanged = options.onPreviewChanged;
    this.store = store;
    this.router = new ToolRouter({
      select,
      getObject: (id) => store.get(id),
      onChange: () => {
        this.text.noteEditing();
        onChange();
      },
      ...(onToolChange === undefined ? {} : { onToolChange }),
    });
    this.text = new DocumentText({
      store,
      origin: options.origin,
      environment: options.environment,
      history: options.history,
      layout: options.textLayout ?? NO_TEXT_LAYOUT,
      requestExit: () => {
        this.router.finishActiveMode();
      },
      activeMode: () => this.router.activeMode,
      selectTool: select,
      setPreview: (id, object) => {
        if (object === undefined) this.previews.delete(id);
        else this.previews.set(id, object);
        options.onPreviewChanged([id]);
      },
      textAt: options.textAt,
      onChange,
      ...(options.onNotice === undefined ? {} : { onNotice: options.onNotice }),
      ...(options.textToolStyle === undefined ? {} : { toolStyle: options.textToolStyle }),
      ...(options.toolStyleOf === undefined ? {} : { toolStyleOf: options.toolStyleOf }),
      ...(options.onCommandRefused === undefined
        ? {}
        : { onCommandRefused: options.onCommandRefused }),
    });
    const { snapIndex } = options;
    this.modeServices = {
      ...this.text.services(),
      ...(snapIndex === undefined ? {} : { snapIndex }),
      ...(options.snapPoint === undefined ? {} : { snapPoint: options.snapPoint }),
      ...(options.pickImages === undefined ? {} : { pickImages: options.pickImages }),
      ...(options.panView === undefined ? {} : { panView: options.panView }),
      ...(options.viewCentre === undefined ? {} : { viewCentre: options.viewCentre }),
      ...(options.liveInk === undefined ? {} : { liveInk: options.liveInk }),
      ...(options.creationInk === undefined ? {} : { creationInk: options.creationInk }),
      connectorTargetAt: options.connectorTargetAt,
      ...(options.stickyAt === undefined ? {} : { stickyAt: options.stickyAt }),
    };
    registerToolModes(this.router, this.modeServices);
  }

  /**
   * What the tool modes work on: the text side's services with the snap index, the pen's
   * point snapping and what a connector end attaches to.
   *
   * @returns The services.
   */
  services(): ToolModeServices {
    return this.modeServices;
  }

  /**
   * Takes a component action that previews a main on the page shown in one axis value's preset,
   * or clears that preview without an axis and value: its children as the preset draws
   * them, writing nothing. Every other component action is the panels'.
   *
   * @param action - A component action.
   * @returns True for a preview, taken; undefined for any other action.
   */
  previewPreset(action: ComponentAction): true | undefined {
    if (action.command !== 'previewPreset') return undefined;
    const main = this.store.get(action.id);
    const { axis, value } = action;
    const records =
      main?.type === 'component' && axis !== undefined && value !== undefined
        ? main.variantPresets?.[presetKey(axis, value)]
        : undefined;
    this.showPresetPreview(
      records === undefined
        ? { objects: [], hiddenIds: [] }
        : presetPreviewObjects(this.store, records),
    );
    return true;
  }

  /**
   * Shows a main's children as one of its presets draws them, replacing the preset
   * preview shown before; none clears it. Nothing is written.
   *
   * @param preview - The children it changes and hides (`presetPreviewObjects`).
   */
  showPresetPreview(preview: PresetPreview): void {
    const before = [...this.presetPreviewIds, ...this.presetHiddenIds];
    for (const id of this.presetPreviewIds) this.previews.delete(id);
    for (const object of preview.objects) this.previews.set(object.id, object);
    this.presetPreviewIds = preview.objects.map(({ id }) => id);
    this.presetHiddenIds = new Set(preview.hiddenIds);
    const changed = new Set([...before, ...this.presetPreviewIds, ...this.presetHiddenIds]);
    if (changed.size > 0) this.onPreviewChanged([...changed]);
  }

  /**
   * The document as the scene draws it: the modes' previews over a source (the select tool's,
   * which lays its drag preview over the document).
   *
   * @param base - The source below.
   * @returns The source with the previews on top.
   */
  sourceOver(base: SceneSource): PreviewedSource {
    return {
      get: (id) =>
        this.presetHiddenIds.has(id) ? undefined : (this.previews.get(id) ?? base.get(id)),
      // A preset preview shows on the main alone: its instances read the main as stored.
      definitions: {
        get: (id) =>
          (this.presetPreviewIds.includes(id) ? undefined : this.previews.get(id)) ?? base.get(id),
      },
    };
  }

  /**
   * The overlay to show: the select tool's, with the active mode's laid over it, in the editing
   * states' colours of the viewer's theme (`CreationInkSource.overlayPalette`) when the
   * shell gives them. Its labels are published to {@link DocumentTools.labels}.
   *
   * @returns The model.
   */
  overlay(): SelectionOverlayModel {
    const model = this.router.overlay();
    this.labels.publish(model.labels);
    const palette = this.modeServices.creationInk?.overlayPalette?.();
    return palette === undefined ? model : { ...model, palette };
  }

  /**
   * Shows the overlay again though no tool changed: its colours did (a new theme).
   */
  refresh(): void {
    this.onChange();
  }

  /**
   * Offers a canvas action to the tools: bold and italic to the text styling (the text being
   * edited, or the selected text objects), any other key to the active mode.
   *
   * @param action - The action.
   * @returns Whether the tools used it.
   */
  runKey(action: CanvasAction): boolean {
    if (action.type === 'replaceMissingFont') {
      this.text.openBoardFontReplacement(action.family);
      return true;
    }
    if (action.type === 'selection') {
      const { command } = action;
      if (isTextToggle(command)) {
        return this.text.apply({ kind: command });
      }
      if (command === 'cropImageFill') return this.cropImageFill();
    }
    const key = toolKeyOf(action);
    return key !== undefined && this.router.handleKey(key);
  }

  /**
   * Enters fill crop mode (the paint control's "Crop image…") on the one selected shape
   * or frame whose fill is an image; nothing for another selection, a locked object or a fill
   * that is not an image (`fillCropModeOf`).
   *
   * @returns Whether a crop mode started.
   */
  private cropImageFill(): boolean {
    const services = this.modeServices;
    // The active mode ends first (a crop mode already open commits), so the new mode starts from
    // the object as it is then and its previews are not dropped by the old mode leaving.
    this.router.finishActiveMode();
    const [id, ...more] = services.selectTool.selection.ids;
    const object = id === undefined || more.length > 0 ? undefined : services.store.get(id);
    if (object?.type !== 'shape' && object?.type !== 'frame') return false;
    const frame = orientedBoxOf(object.id, services.selectTool.source);
    const mode = frame && fillCropModeOf(cropContextOf(services), object, frame);
    if (mode === undefined) return false;
    this.router.enter(mode);
    return true;
  }

  /** Ends the active mode and stops the typing policy. */
  destroy(): void {
    this.router.destroy();
    this.text.destroy();
  }
}
