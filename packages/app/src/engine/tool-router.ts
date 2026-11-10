import { isDrawableIn, type Camera } from '@canvas/engine';
import type { BoardObject, ObjectId, ObjectType, Point } from '@canvas/schema';
import {
  type SelectActivation,
  type SelectController,
  type SelectInput,
  type SelectionOverlayModel,
  type SnapSettings,
  type ToolCursor,
  type ToolId,
  type ToolKeyInput,
  type ToolMode,
  type ToolPointerInput,
} from '@canvas/tools';

/**
 * Whether a tool only looks at the board: the select tool and the hand, the tools a
 * person who cannot edit may make active.
 *
 * @param tool - The tool.
 * @returns True for `select` and `hand`.
 */
function isLookingTool(tool: ToolId): boolean {
  return tool === 'select' || tool === 'hand';
}

/** Builds a tool's mode when the toolbar makes the tool active. */
export type ToolModeFactory = () => ToolMode;

/**
 * Builds the mode that edits an activated object (a double-click on it, or Enter with it alone
 * selected), or declines with `undefined` (a locked object, a type it cannot edit).
 */
export type ActivationModeFactory = (
  activation: SelectActivation,
  object: BoardObject,
) => ToolMode | undefined;

/** What a {@link ToolRouter} routes to and reports to. */
export interface ToolRouterOptions {
  /**
   * The select tool, whose overlay is the base every mode's fields are laid over; its mode (the
   * `select` registration, `modes/select-mode.ts`) is the default tool's.
   */
  readonly select: SelectController;
  /** Reads an activated object, to pick its mode by type. */
  readonly getObject: (id: BoardObject['id']) => BoardObject | undefined;
  /** Called when what the router shows changed (a mode's overlay or cursor, a mode ending). */
  readonly onChange: () => void;
  /**
   * Called when the active tool changes from inside the canvas: a mode that finished hands back
   * to `select`, an activation makes the mode's tool active. The shell shows it in the toolbar.
   */
  readonly onToolChange?: (tool: ToolId) => void;
}

/**
 * Routes the canvas's primary button, cursor and keys to the active tool: each toolbar tool's `ToolMode` comes from its registration
 * (`registerToolMode`, fed by the `modes/` registry, the select tool's own mode included), and a
 * tool with none registered yet leaves primary-button input unused, with the default cursor. The
 * toolbar makes a tool active (`setActiveTool`: the active mode ends, the tool's starts); the
 * select tool's `activate` intent starts the mode registered for the object's type
 * (`registerActivation`: text and sticky edit their text, a shape its label, a path enters vector
 * editing, an image crop). A mode that finishes hands back to the select tool, which takes the
 * same input when the mode passes it on. The overlay is always the select tool's, with the
 * active mode's fields laid over it. One router per mount, used by both the worker host mount
 * and the main-thread fallback through the engine's document side. Main thread.
 */
export class ToolRouter {
  private readonly options: ToolRouterOptions;
  private readonly toolModes = new Map<ToolId, ToolModeFactory>();
  private readonly activations = new Map<ObjectType, ActivationModeFactory>();
  private tool: ToolId = 'select';
  private mode: ToolMode | undefined;
  /**
   * Whether the active mode is the one the active toolbar tool started, rather than one an
   * activation or a sub-tool switch started (vector editing shows the select tool's id while it
   * is not the select tool's mode).
   */
  private isToolbarMode = true;

  /**
   * Starts with the select tool active and no modes registered: until the select tool's mode is
   * registered, input goes nowhere.
   *
   * @param options - The select tool, the document reader and the change callbacks.
   */
  constructor(options: ToolRouterOptions) {
    this.options = options;
  }

  /**
   * The mode receiving input now: the active tool's (the select tool's while it is active).
   *
   * @returns The mode, or undefined while a tool with no registered mode is active.
   */
  get activeMode(): ToolMode | undefined {
    return this.mode;
  }

  /**
   * The tool the canvas acts as now: the toolbar's choice, or the mode an activation started.
   *
   * @returns The tool.
   */
  get activeTool(): ToolId {
    return this.tool;
  }

  /**
   * The cursor the active mode asks for, or `default` for a tool without a mode.
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    return this.mode?.cursor ?? 'default';
  }

  /**
   * Registers the mode a toolbar tool starts; a later registration for the tool replaces it. The
   * active tool's first registration starts its mode at once (the select tool's, at mount).
   *
   * @param tool - The tool.
   * @param factory - Builds its mode each time the tool is made active.
   */
  registerToolMode(tool: ToolId, factory: ToolModeFactory): void {
    this.toolModes.set(tool, factory);
    if (tool === this.tool && this.mode === undefined) this.mode = factory();
  }

  /**
   * Registers the mode an activated object of one type enters; a later registration for the type
   * replaces it.
   *
   * @param type - The object type.
   * @param factory - Builds the mode for an activated object of that type.
   */
  registerActivation(type: ObjectType, factory: ActivationModeFactory): void {
    this.activations.set(type, factory);
  }

  /**
   * Makes a toolbar tool active: ends the active mode (unless it is already this tool's; ending
   * the select tool's cancels a drag), then starts the tool's registered mode, if it has one. A
   * mode with sub-tools is asked first (`onToolSwitch`): vector editing's V and P hand the same
   * path between its move and pen sub-tools, and the shell is told the tool shown when the mode
   * keeps another (the pen keeps a lone first point on V). While the person cannot edit,
   * only the select tool can be made active.
   *
   * @param tool - The tool the shell shows as pressed.
   */
  setActiveTool(tool: ToolId): void {
    if (this.mode?.id === tool || (!isLookingTool(tool) && this.isReadOnly())) return;
    // A mode with sub-tools (vector editing's move and pen) may carry on as the new tool.
    const next = this.mode?.onToolSwitch?.(tool);
    if (next) {
      if (next !== this.mode) this.isToolbarMode = false;
      this.mode = next;
      this.tool = next.id;
      if (next.id !== tool) this.options.onToolChange?.(next.id);
      this.options.onChange();
      return;
    }
    this.endMode();
    this.startTool(tool);
    this.options.onChange();
  }

  /**
   * The toolbar's button of the active tool was pressed again: for the select tool, a mode an
   * activation or a sub-tool switch started under its name (vector editing shows the select
   * tool) ends, as it would on Escape, and the select tool's own mode starts. Nothing for any
   * other tool (the pressed Text button leaves a text edit running, as before), while the
   * select tool's own mode runs, or for another tool than the one active.
   *
   * @param tool - The tool whose button was pressed.
   */
  reselectTool(tool: ToolId): void {
    if (tool !== 'select' || tool !== this.tool) return;
    if (this.mode === undefined || this.isToolbarMode) return;
    this.endMode();
    this.startTool(tool);
    this.options.onChange();
  }

  /**
   * Hands primary-button input to the active mode; a mode that finishes on it hands back to the
   * select tool, which takes the same input when the mode passes it on.
   *
   * @param input - The input with its world point, as the select tool takes it.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @param camera - The camera now, which the select tool sizes its badges by.
   * @param snapping - How drags snap; none when absent.
   */
  handlePointer(
    input: SelectInput & { readonly kind: ToolPointerInput['kind'] },
    zoom: number,
    camera?: Camera,
    snapping?: SnapSettings,
  ): void {
    const { mode } = this;
    if (!mode) return;
    const step = mode.onPointer(
      input.kind === 'pointerCancel'
        ? input
        : input.kind === 'hold'
          ? { ...input, zoom }
          : { ...input, zoom, ...(camera && { camera }), ...(snapping && { snapping }) },
    );
    if (!step.isDone) {
      if (step.isShown !== true) this.options.onChange();
      return;
    }
    this.finishMode();
    if (step.isPassedOn) this.handlePointer(input, zoom, camera, snapping);
  }

  /**
   * Brings the active mode's resting cursor up to date after the camera moved under a still
   * pointer (the select tool's rotate cursor); a mode without one ignores it.
   *
   * @param world - The pointer, world units.
   * @param camera - The camera now.
   */
  refreshCursor(world: Point, camera: Camera): void {
    this.mode?.refreshCursor?.(world, camera);
  }

  /**
   * Offers a canvas key to the active mode.
   *
   * @param input - The key.
   * @returns Whether the mode used it; when not, the caller runs it as a selection shortcut.
   */
  handleKey(input: ToolKeyInput): boolean {
    const isUsed = this.mode?.onKey(input) ?? false;
    if (isUsed) this.options.onChange();
    return isUsed;
  }

  /**
   * Whether activating an object would start a mode (`TouchCallbacks.canActivate`): it exists,
   * is unlocked, the engine can draw it (a mode never edits values a peer wrote past
   * the commands), and a mode is registered for its type (text now; sticky notes and shape
   * labels when their tasks register theirs). A finger's double-tap on such an object edits it
   * rather than zooming to it.
   *
   * @param id - The object.
   * @returns True when an activation would start a mode.
   */
  canActivate(id: ObjectId): boolean {
    const object = this.options.getObject(id);
    return (
      !this.isReadOnly() &&
      object !== undefined &&
      !object.locked &&
      this.activations.has(object.type) &&
      this.isDrawable(object)
    );
  }

  /**
   * Whether the person cannot edit the board (the select tool says): then no creation
   * tool's mode and no activated object's mode starts.
   *
   * @returns True while the select tool is read-only.
   */
  private isReadOnly(): boolean {
    return !this.options.select.canEdit;
  }

  /**
   * Whether the engine draws an object, its ancestors read from the document.
   *
   * @param object - The object.
   * @returns True when it is drawable.
   */
  private isDrawable(object: BoardObject): boolean {
    return isDrawableIn(object, { get: (id) => this.options.getObject(id) });
  }

  /**
   * Starts the mode registered for an activated object's type, ending the active mode first
   * (ending the select tool's drops the press that activated, as the new mode takes the rest of
   * it); nothing when none is registered, the object is gone or cannot be drawn, the factory
   * declines, or the person cannot edit (a viewer's double-click opens no editor).
   *
   * @param activation - The select tool's `activate` intent.
   */
  activate(activation: SelectActivation): void {
    if (this.isReadOnly()) return;
    const found = this.options.getObject(activation.id);
    const object = found && this.isDrawable(found) ? found : undefined;
    const factory = object && this.activations.get(object.type);
    const mode = object && factory?.(activation, object);
    if (mode) this.enter(mode);
  }

  /**
   * Starts a mode that edits an object, built outside activation (fill crop mode, from
   * the paint control's "Crop image…"): the active mode ends and the new one shows under its
   * tool's name, as an activated object's does; nothing for a person who cannot edit.
   *
   * @param mode - The mode.
   */
  enter(mode: ToolMode): void {
    if (this.isReadOnly()) return;
    this.endMode();
    this.mode = mode;
    this.tool = mode.id;
    this.isToolbarMode = false;
    this.options.onToolChange?.(mode.id);
    this.options.onChange();
  }

  /**
   * The overlay to show: the select tool's model with the active mode's fields laid over it,
   * its tool rectangles appended to the select tool's.
   *
   * @returns The model.
   */
  overlay(): SelectionOverlayModel {
    const base = this.options.select.overlay();
    const extra = this.mode?.overlay();
    if (!extra || Object.keys(extra).length === 0) return base;
    return { ...base, ...extra, toolRects: [...base.toolRects, ...(extra.toolRects ?? [])] };
  }

  /**
   * Ends the active mode from outside an input (Escape, the object it edits deleted by someone
   * else): back to the select tool, which the shell is told. Nothing while the select tool's own
   * mode is active (vector editing, which shows the select tool, is ended).
   */
  finishActiveMode(): void {
    if (this.mode && (this.tool !== 'select' || !this.isToolbarMode)) this.finishMode();
  }

  /**
   * Ends the active mode writing nothing (`ToolMode.abandon`, else its `exit`), for a person who
   * can no longer edit: a gesture under way, a text edit, a path, a crop are dropped,
   * not committed. The select tool's own mode then starts afresh, which the shell is told.
   */
  abandonActiveMode(): void {
    const { mode } = this;
    this.mode = undefined;
    if (mode?.abandon) mode.abandon();
    else mode?.exit();
    this.startTool('select');
    this.options.onToolChange?.('select');
    this.options.onChange();
  }

  /**
   * Tells the active mode the zoom changed with no input (a wheel zoom, a fit).
   *
   * @param zoom - The camera zoom now.
   */
  followZoom(zoom: number): void {
    this.mode?.onZoom?.(zoom);
  }

  /** Ends the active mode, if any, without reporting a tool change. */
  destroy(): void {
    this.endMode();
  }

  /**
   * Makes a tool active and starts its registered mode, if any.
   *
   * @param tool - The tool.
   */
  private startTool(tool: ToolId): void {
    this.tool = tool;
    this.isToolbarMode = true;
    this.mode = this.toolModes.get(tool)?.();
  }

  /** Ends the active mode (it commits what it was doing) and keeps the active tool. */
  private endMode(): void {
    const { mode } = this;
    if (!mode) return;
    this.mode = undefined;
    mode.exit();
  }

  /** A mode finished on its own: back to the select tool, which the shell is told. */
  private finishMode(): void {
    this.endMode();
    this.startTool('select');
    this.options.onToolChange?.('select');
    this.options.onChange();
  }
}
