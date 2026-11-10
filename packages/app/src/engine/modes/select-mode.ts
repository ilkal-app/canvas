import type { Camera } from '@canvas/engine';
import type { Point } from '@canvas/schema';
import {
  ConnectorEndpoints,
  ConnectorLabelDrag,
  ConnectorRouteHandles,
  LineEndpoints,
  TOOL_STEP_CONTINUE,
  type SelectController,
  type SelectionOverlayModel,
  type SelectPointer,
  type SelectPointerType,
  type ToolCursor,
  type ToolKeyInput,
  type ToolMode,
  type ToolPointerInput,
  type ToolStep,
} from '@canvas/tools';

import { lineToolContextOf } from './line-mode.js';
import type { ToolModeEntry } from './tool-mode-entry.js';

/**
 * A lone selected object's end handles, which take presses before the select tool: a line's
 * (`LineEndpoints`) or a connector's (`ConnectorEndpoints`).
 */
export interface EndpointEditor {
  /** Whether an end is being dragged. */
  readonly isDragging: boolean;
  /**
   * The handle under a point, if any.
   *
   * @param world - The pointer, world units.
   * @param zoom - The camera zoom.
   * @param pointerType - The pointer, which sizes the target.
   * @returns The handle, or `undefined`.
   */
  handleAt(world: Point, zoom: number, pointerType?: SelectPointerType): unknown;
  /**
   * Offers a press.
   *
   * @param press - The press.
   * @param zoom - The camera zoom.
   * @returns Whether it was taken.
   */
  press(press: SelectPointer, zoom: number): boolean;
  /**
   * Takes a pointer input while an end is dragged.
   *
   * @param input - The input.
   */
  follow(input: ToolPointerInput): void;
  /** Drops a drag under way. */
  cancel(): void;
  /**
   * Remembers a new zoom.
   *
   * @param zoom - The camera zoom.
   * @returns Whether the handles show and must be redrawn.
   */
  followZoom(zoom: number): boolean;
  /**
   * What the handles show over the select tool's overlay.
   *
   * @returns The fields, or none when the selection has no such handles.
   */
  overlay(): Partial<SelectionOverlayModel> | undefined;
  /**
   * A press it took that turned out to be a click (a connector's label), once: the select
   * tool takes those inputs instead, so the click selects or edits as before.
   *
   * @returns The inputs, or `undefined`.
   */
  takeClick?(): readonly ToolPointerInput[] | undefined;
  /**
   * Whether its handles hide while another editor drags (a connector's route handle,
   * while an end is dragged): its source does not hold that drag's preview.
   */
  readonly isHiddenDuringOtherDrags?: boolean;
}

/** The select tool's step: never done, and already shown through its controller's `onChange`. */
const SELECT_STEP: ToolStep = Object.freeze({ isDone: false, isShown: true });

/** What the select tool adds over its own overlay: nothing, since the router's base is its. */
const NOTHING_ADDED: Partial<SelectionOverlayModel> = Object.freeze({});

/**
 * The select tool as a tool mode: a thin view of the one `SelectController` the engine's document
 * side keeps, so the router treats it like any other mode (the primary button, the cursor, the
 * active-tool gate) while the selection outlives every switch of tool. Its keys stay with the
 * selection shortcuts (`engine-document-commands.ts`); its overlay is the router's base, so it adds
 * nothing to it but a lone selected line's or connector's end handles (`LineEndpoints`,
 * `ConnectorEndpoints`): a press on one drags that end instead of reaching the select tool,
 * and Escape drops that drag. Their frame offers no controls (the controller is made with
 * `hasLineEndHandles`), so a press beside it draws a marquee. Ending it cancels a gesture under
 * way. Main thread.
 */
export class SelectToolMode implements ToolMode {
  readonly id = 'select' as const;
  private readonly controller: SelectController;
  private readonly editors: readonly EndpointEditor[];
  private readonly onChange: (() => void) | undefined;
  /** Whether the pointer last hovered over an end handle. */
  private isOverHandle = false;

  /**
   * Wraps the select tool.
   *
   * @param controller - The select tool the document side keeps.
   * @param editors - A lone selected line's and connector's end editing; none if absent.
   * @param onChange - Redraws what the mode shows (the handles at a new zoom).
   */
  constructor(
    controller: SelectController,
    editors: readonly EndpointEditor[] = [],
    onChange?: () => void,
  ) {
    this.controller = controller;
    this.editors = editors;
    this.onChange = onChange;
  }

  /**
   * The select tool's cursor (the rotate cursor over a corner band, else the default).
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    // Over an end handle, or dragging one, the press moves the end: no rotate cursor.
    return this.isOverHandle || this.dragging() !== undefined ? 'default' : this.controller.cursor;
  }

  /**
   * Feeds one pointer input to the select tool; its drags snap as the input's settings say.
   *
   * @param input - The input with its world point, the zoom, the camera and the snapping.
   * @returns A step that keeps the tool active, already shown.
   */
  onPointer(input: ToolPointerInput): ToolStep {
    // A viewer gets no end handles: the select tool alone, which only selects.
    const editors = this.controller.canEdit ? this.editors : [];
    const dragging = this.dragging(editors);
    if (dragging) {
      dragging.follow(input);
      for (const click of dragging.takeClick?.() ?? []) this.handleSelect(click);
      return TOOL_STEP_CONTINUE;
    }
    if (input.kind === 'pointerDown' && editors.some((editor) => editor.press(input, input.zoom))) {
      return TOOL_STEP_CONTINUE;
    }
    if (input.kind === 'pointerMove') {
      this.isOverHandle = editors.some(
        (editor) => editor.handleAt(input.world, input.zoom, input.pointerType) !== undefined,
      );
    }
    this.handleSelect(input);
    return SELECT_STEP;
  }

  /**
   * Hands one input to the select tool.
   *
   * @param input - The input.
   */
  private handleSelect(input: ToolPointerInput): void {
    if (input.kind === 'pointerCancel') this.controller.handle(input, 1);
    else if (input.kind === 'hold') this.controller.handle(input, input.zoom);
    else this.controller.handle(input, input.zoom, input.camera, input.snapping);
  }

  /**
   * Turns the rotate cursor to the pointer's new world point after the camera moved under it.
   *
   * @param world - The pointer, world units.
   * @param camera - The camera now; its zoom sizes the rotation bands.
   */
  refreshCursor(world: Point, camera: Camera): void {
    this.controller.refreshCursor(world, camera.zoom, camera);
  }

  /**
   * Takes Escape while an end is dragged (the drag is dropped); declines every other key: the
   * select tool's keys are the selection shortcuts, which the document side runs itself.
   *
   * @param input - The key.
   * @returns Whether it was used.
   */
  onKey(input: ToolKeyInput): boolean {
    const dragging = this.dragging();
    if (input.kind !== 'escape' || dragging === undefined) return false;
    dragging.cancel();
    return true;
  }

  /**
   * A lone selected line's or connector's end handles in place of its frame, with a connector's
   * route handle, for a person who can edit; otherwise nothing, since the router lays
   * every mode's fields over the select tool's own model.
   *
   * @returns The fields to lay over the select tool's.
   */
  overlay(): Partial<SelectionOverlayModel> {
    if (!this.controller.canEdit) return NOTHING_ADDED;
    // Every editor's handles at once (a connector's ends and its route handle): an earlier
    // editor's fields win, and its rectangles are drawn over a later one's.
    let merged: Partial<SelectionOverlayModel> | undefined;
    const dragging = this.dragging();
    for (const editor of [...this.editors].reverse()) {
      const isHidden =
        editor.isHiddenDuringOtherDrags && dragging !== undefined && dragging !== editor;
      const shown = isHidden ? undefined : editor.overlay();
      if (!shown) continue;
      const toolRects = [...(merged?.toolRects ?? []), ...(shown.toolRects ?? [])];
      merged = { ...merged, ...shown, toolRects };
    }
    return merged ?? NOTHING_ADDED;
  }

  /**
   * Resizes the end handles for a new zoom, if they show.
   *
   * @param zoom - The camera zoom now.
   */
  onZoom(zoom: number): void {
    const shown = this.editors.map((editor) => editor.followZoom(zoom));
    if (shown.includes(true)) this.onChange?.();
  }

  /** Cancels a press or drag under way, as leaving the select tool always has. */
  exit(): void {
    for (const editor of this.editors) editor.cancel();
    if (this.controller.isGesturing) this.controller.handle({ kind: 'pointerCancel' }, 1);
  }

  /**
   * The editor whose end is being dragged.
   *
   * @param editors - The editors to look in; this mode's by default.
   * @returns It, or `undefined`.
   */
  private dragging(editors: readonly EndpointEditor[] = this.editors): EndpointEditor | undefined {
    return editors.find((editor) => editor.isDragging);
  }
}

/**
 * The select tool (`v`, the default): the mode is the document side's one select tool, with a
 * lone selected line's end editing and a lone selected connector's over the
 * scene's source.
 */
export const toolModeEntry: ToolModeEntry = {
  tool: 'select',
  activates: [],
  create: (services) => {
    const { selectTool } = services;
    const shared = {
      ...lineToolContextOf(services),
      source: selectTool.source,
      selection: () => selectTool.selection.ids,
    };
    const editors = [
      // A lone selected connector's route handle first: a label at the midpoint lies
      // under it, and the label's box is larger, so it can still be pressed beside the handle.
      new ConnectorRouteHandles(shared),
      // A press on a connector's label drags it along the connector, before the ends: a
      // label dragged to an end lies over that end's handle, and must come away from it again.
      new ConnectorLabelDrag(shared),
      new LineEndpoints(shared),
      new ConnectorEndpoints({
        ...shared,
        objectAt: (world, zoom) => services.connectorTargetAt?.(world, zoom),
      }),
    ];
    return new SelectToolMode(selectTool, editors, services.onChange);
  },
};
