import { createObjectCommand, runCommand } from '@canvas/document';
import { visibleWorldBounds } from '@canvas/engine';
import type { ObjectId, Point, ShapeObject } from '@canvas/schema';

import { withCreationParent } from '../frame/creation-parent.js';
import { creationColor } from '../ink/creation-ink.js';
import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import { SNAPPING_OFF } from '../select/drag-snap.js';
import { extentLabelOf } from '../select/overlay-label.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import { CLICK_THRESHOLD_PX } from '../select/select-tool.js';
import type { SnapGuide } from '../snap/snap-guide.js';
import type { TextModeContext } from '../text/text-mode-context.js';
import { TextMode } from '../text/text-mode.js';
import { DRAFT_PREVIEW_Z } from '../text/text-session-object.js';
import type { TextEditingSession } from '../text/text-session.js';

import { snapCreationPoint, type CreationSnapSource } from './creation-snap.js';
import {
  DEFAULT_SHAPE_STYLE,
  newShapeObject,
  type NewShapeObject,
  type NewShapeStyle,
  type ShapeBox,
} from './new-shape-object.js';
import { clickedShapeBox, shapeDragBox } from './shape-drag.js';

/** What the shape mode works on: a text mode's context (for labels), the tool's style, snapping. */
export interface ShapeModeContext extends TextModeContext {
  /**
   * The style a new shape takes: the shape tool's, its kind the one last picked;
   * {@link DEFAULT_SHAPE_STYLE} when absent. `newTextStyle` is the style its label is typed in.
   */
  readonly newShapeStyle?: () => NewShapeStyle;
  /** Where a creation drag finds objects to snap to; it snaps to the grid only when absent. */
  readonly snap?: CreationSnapSource;
}

/** How a shape mode starts. */
export type ShapeModeStart =
  | {
      /** The shape tool: a drag (or a click) on the board creates a shape. */
      readonly kind: 'create';
    }
  | {
      /** Editing an existing shape's label (a double-click on it, or Enter). */
      readonly kind: 'edit';
      /** The shape. */
      readonly id: ObjectId;
      /** Where the caret goes; the whole label is selected when omitted (Enter). */
      readonly world?: Point;
    };

/** A primary-button input: a press, a move or a release, with its points and modifiers. */
type PrimaryPointer = Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }>;

/** The creation drag in progress. */
interface ShapeDrag {
  /** The press. */
  readonly press: SelectPointer;
  /** The press, snapped: the drag's fixed corner (or centre, with Alt). */
  readonly anchor: Point;
  /** The id the new shape is previewed and created under. */
  readonly id: ObjectId;
  /** The box the pointer describes now; undefined until it moved past the click threshold. */
  box: ShapeBox | undefined;
  /** The style the shape takes, its outline colour chosen at the press (`creationColor`). */
  readonly style: NewShapeStyle;
}

/**
 * The shape tool, `r`: a drag on the board draws a
 * shape of the tool's kind in its style (`ShapeModeContext.newShapeStyle`), previewed as it is
 * dragged; Shift keeps it 1:1 and Alt (Option) draws it from the press as its centre; the drag's
 * corner snaps to objects and the grid (`snapCreationPoint`), except with Shift or Alt held (Alt
 * is also the key that suspends snapping). A click makes a 100-unit square one centred on it.
 * The shape is created by one `createObject`, so one undo step, selected, and the select tool
 * takes over. An activated shape (double-click, Enter) has its label edited with the text editor
 * (`TextMode`), centred in the box inscribed in its kind. Main thread; no DOM.
 */
export class ShapeMode implements ToolMode {
  readonly id = 'shape' as const;
  private readonly context: ShapeModeContext;
  /** The editor on the shape's label, when the mode edits one. */
  private readonly editing: TextMode | undefined;
  private drag: ShapeDrag | undefined;
  private guides: readonly SnapGuide[] = [];

  /**
   * Starts the mode.
   *
   * @param context - The document, layout, undo grouping, callbacks and the tool's style.
   * @param start - Whether to create shapes or edit a label.
   */
  constructor(context: ShapeModeContext, start: ShapeModeStart) {
    this.context = context;
    if (start.kind === 'edit') {
      const editing = new TextMode(context, start);
      this.editing = editing.session === undefined ? undefined : editing;
    }
  }

  /**
   * The label's editing session, while one runs: what the hidden text input and the style panel
   * drive.
   *
   * @returns The session, or `undefined` while the mode creates shapes.
   */
  get session(): TextEditingSession | undefined {
    return this.editing?.session;
  }

  /**
   * A crosshair over the board, or the editor's I-beam over a label.
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    return this.editing?.cursor ?? 'crosshair';
  }

  onPointer(input: ToolPointerInput): ToolStep {
    if (this.editing !== undefined) return this.editing.onPointer(input);
    switch (input.kind) {
      case 'pointerDown':
        this.press(input);
        return TOOL_STEP_CONTINUE;
      case 'pointerMove':
        this.follow(input);
        return TOOL_STEP_CONTINUE;
      case 'pointerUp':
        return this.release(input);
      case 'pointerCancel':
        this.cancel();
        return TOOL_STEP_CONTINUE;
      default:
        return TOOL_STEP_CONTINUE;
    }
  }

  onKey(input: ToolKeyInput): boolean {
    if (this.editing !== undefined) return this.editing.onKey(input);
    if (input.kind !== 'escape') return false;
    if (this.drag !== undefined) this.cancel();
    else this.context.requestExit();
    return true;
  }

  overlay(): Partial<SelectionOverlayModel> {
    if (this.editing !== undefined) return this.editing.overlay();
    const box = this.drag?.box;
    return box === undefined ? {} : { guides: this.guides, labels: [extentLabelOf(box)] };
  }

  onZoom(zoom: number): void {
    this.editing?.onZoom(zoom);
  }

  exit(): void {
    this.cancel();
    this.editing?.exit();
  }

  abandon(): void {
    this.cancel();
    this.editing?.abandon();
  }

  /**
   * Starts a creation drag: its fixed corner is the press, snapped unless Shift or Alt is held.
   *
   * @param input - The press.
   */
  private press(input: PrimaryPointer): void {
    this.cancel();
    const anchor = this.snapped(input.world, input).point;
    const style = this.styleAt(input.world);
    this.drag = {
      press: input,
      anchor,
      id: this.context.environment.createId(),
      box: undefined,
      style,
    };
  }

  /**
   * Follows the drag once it has moved past the click threshold: the box to the pointer (its
   * corner snapped), previewed as the shape it will create.
   *
   * @param input - The move.
   */
  private follow(input: PrimaryPointer): void {
    const { drag } = this;
    if (drag === undefined) return;
    const moved = Math.hypot(
      input.screen.x - drag.press.screen.x,
      input.screen.y - drag.press.screen.y,
    );
    if (drag.box === undefined && moved < CLICK_THRESHOLD_PX) return;
    const snapped = this.snapped(input.world, input);
    this.guides = snapped.guides;
    drag.box = shapeDragBox(drag.anchor, snapped.point, modifiersOf(input));
    this.context.setPreview(drag.id, this.previewOf(drag.id, drag.box, drag.style));
    this.context.onChange();
  }

  /**
   * Ends the press: creates the dragged shape, or a default one centred on a click.
   *
   * @param input - The release.
   * @returns Done once a shape was created, so the select tool takes over with it selected.
   */
  private release(input: PrimaryPointer): ToolStep {
    const { drag } = this;
    if (drag === undefined) return TOOL_STEP_CONTINUE;
    this.follow({ ...input, kind: 'pointerMove' });
    const box = drag.box ?? clickedShapeBox(drag.press.world);
    const created = this.create(newShapeObject(box, drag.style), drag.id);
    this.cancel();
    if (created === undefined) return TOOL_STEP_CONTINUE;
    this.context.selectObjects([created]);
    return { isDone: true };
  }

  /** Drops the drag and its preview, writing nothing. */
  private cancel(): void {
    const { drag } = this;
    this.drag = undefined;
    this.guides = [];
    if (drag?.box === undefined) return;
    this.context.setPreview(drag.id, undefined);
    this.context.onChange();
  }

  /**
   * Creates the shape as its own undo step; a refusal is reported and nothing is created.
   *
   * @param object - The shape.
   * @param id - Its id, the one its preview showed.
   * @returns The created shape's id, or undefined when the document refused it.
   */
  private create(object: NewShapeObject, id: ObjectId): ObjectId | undefined {
    const { context } = this;
    let created: ObjectId | undefined;
    context.capture.command(() => {
      const { store, origin, environment } = context;
      // Drawn in a section, it joins it (item 9).
      const input = { object: withCreationParent(store, { ...object, id }) };
      const outcome = runCommand(store, origin, createObjectCommand, input, environment);
      if (outcome.status === 'applied') created = outcome.result.id;
      else context.onCommandRefused?.(outcome.errors);
    });
    return created;
  }

  /**
   * The shape a drag previews: the object it will create, on top of everything (`DRAFT_PREVIEW_Z`).
   *
   * @param id - Its id.
   * @param box - Its box.
   * @param style - The style it takes.
   * @returns The preview.
   */
  private previewOf(id: ObjectId, box: ShapeBox, style: NewShapeStyle): ShapeObject {
    const now = this.context.environment.clock();
    return {
      ...newShapeObject(box, style),
      id,
      z: DRAFT_PREVIEW_Z,
      createdBy: this.context.origin.principalId,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * A drag's corner, snapped while snapping is on and neither Shift nor Alt is held.
   *
   * @param point - The corner, world units.
   * @param input - The pointer input, for its modifiers, zoom, camera and preferences.
   * @returns The corner and its guides.
   */
  private snapped(
    point: Point,
    input: PrimaryPointer,
  ): { readonly point: Point; readonly guides: readonly SnapGuide[] } {
    const { isSquare, isFromCentre } = modifiersOf(input);
    if (isSquare || isFromCentre) return { point, guides: [] };
    return snapCreationPoint(point, {
      settings: input.snapping ?? SNAPPING_OFF,
      snap: this.context.snap,
      zoom: input.zoom,
      viewport: input.camera && visibleWorldBounds(input.camera),
    });
  }

  /**
   * The tool's style now.
   *
   * @returns The style new shapes take.
   */
  private style(): NewShapeStyle {
    return this.context.newShapeStyle?.() ?? DEFAULT_SHAPE_STYLE;
  }

  /**
   * The tool's style for a shape whose creation starts at a point: its outline's `ink` resolved
   * there (`creationColor`); a colour the person picked is kept.
   *
   * @param point - The press, world units.
   * @returns The style.
   */
  private styleAt(point: Point): NewShapeStyle {
    const style = this.style();
    if (style.stroke === null) return style;
    const { store, creationInk } = this.context;
    const color = creationColor(store, point, style.stroke.color, creationInk, 'shape');
    return { ...style, stroke: { ...style.stroke, color } };
  }
}

/**
 * A pointer's modifiers as a creation drag reads them: Shift squares the box, Alt (the snap
 * modifier) draws it from its centre.
 *
 * @param input - The pointer.
 * @returns The modifiers.
 */
function modifiersOf(input: SelectPointer): {
  /** Whether the box is square. */
  readonly isSquare: boolean;
  /** Whether the press is the box's centre. */
  readonly isFromCentre: boolean;
} {
  return { isSquare: input.isShiftPressed, isFromCentre: input.isSnapSuspended === true };
}
