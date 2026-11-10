import {
  createFrameCommand,
  runCommand,
  type CommandEnvironment,
  type CommandError,
  type DocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { visibleWorldBounds } from '@canvas/engine';
import type { BoardObject, FrameObject, ObjectId, Point, Rgba } from '@canvas/schema';

import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import { SNAPPING_OFF } from '../select/drag-snap.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import { CLICK_THRESHOLD_PX } from '../select/select-tool.js';
import { snapCreationPoint } from '../shape/creation-snap.js';
import type { ShapeBox } from '../shape/new-shape-object.js';
import { shapeDragBox } from '../shape/shape-drag.js';
import type { SnapGuide } from '../snap/snap-guide.js';
import type { TypingCapture } from '../text/text-mode-context.js';
import { DRAFT_PREVIEW_Z } from '../text/text-session-object.js';

import { nextFrameName } from './frame-name.js';
import { planFramePlacement, type FramePlacementSource } from './frame-placement.js';

/** A frame made by a click (no drag) is this wide, world units, centred on the click. */
export const DEFAULT_FRAME_WIDTH = 400;

/** A frame made by a click is this tall, world units. */
export const DEFAULT_FRAME_HEIGHT = 300;

/** The background a new frame takes: opaque white. */
export const NEW_FRAME_BACKGROUND: Rgba = [1, 1, 1, 1];

/** What the frame mode works on and reports to. Main thread. */
export interface FrameModeContext {
  /** The document; the mode writes to it only through commands. */
  readonly store: DocumentStore;
  /** Who the mode's commands are attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /** How the mode's command joins the person's undo steps. */
  readonly capture: Pick<TypingCapture, 'command'>;
  /** Shows an object as previewed without writing it, or drops the preview. */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** Selects objects with the select tool. */
  readonly selectObjects: (ids: readonly ObjectId[]) => void;
  /** Ends the mode from inside it: back to the select tool. */
  readonly requestExit: () => void;
  /** Called when what the mode shows changed. */
  readonly onChange: () => void;
  /** Receives the errors of a command the document refused. */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
  /**
   * Where the frame's parent and the objects it takes in are looked up, and the drag's corner
   * snaps to: the select tool's index and document. Absent, the frame goes on the root, takes
   * nothing in and snaps to the grid only.
   */
  readonly board?: FramePlacementSource;
  /**
   * The words a new frame's name starts with ("Section" on a floating whiteboard), read
   * as each frame is made; "Frame" when absent or it gives nothing.
   */
  readonly newFrameNamePrefix?: () => string | undefined;
}

/** A primary-button input: a press, a move or a release, with its points and modifiers. */
type PrimaryPointer = Exclude<ToolPointerInput, { readonly kind: 'hold' | 'pointerCancel' }>;

/** The creation drag in progress. */
interface FrameDrag {
  /** The press. */
  readonly press: SelectPointer;
  /** The press, snapped: the drag's fixed corner (or centre, with Alt). */
  readonly anchor: Point;
  /** The id the new frame is previewed and created under. */
  readonly id: ObjectId;
  /** The box the pointer describes now; undefined until it moved past the click threshold. */
  box: ShapeBox | undefined;
}

/**
 * The box a click with the frame tool makes: {@link DEFAULT_FRAME_WIDTH} ×
 * {@link DEFAULT_FRAME_HEIGHT}, centred on the click. Pure.
 *
 * @param centre - The click, world units.
 * @returns The box, world units.
 */
export function clickedFrameBox(centre: Point): ShapeBox {
  return {
    x: centre.x - DEFAULT_FRAME_WIDTH / 2,
    y: centre.y - DEFAULT_FRAME_HEIGHT / 2,
    width: DEFAULT_FRAME_WIDTH,
    height: DEFAULT_FRAME_HEIGHT,
  };
}

/**
 * The frame tool, `f`: a drag on the board draws a
 * frame, previewed as it is dragged (Shift keeps it square, Alt draws it from the press as its
 * centre, its corner snaps as a shape's does); a click makes a 400 × 300 one centred on it. The
 * frame goes into the top-most frame under its centre, or onto the root, and takes in every
 * object wholly inside it there (`planFramePlacement`). It is named "Frame N", one past the
 * board's highest. Creation and adoption are one `createFrame` command, so one undo step; the
 * frame is then selected and the select tool takes over. Main thread; no DOM.
 */
export class FrameMode implements ToolMode {
  readonly id = 'frame' as const;
  readonly cursor: ToolCursor = 'crosshair';
  private readonly context: FrameModeContext;
  private drag: FrameDrag | undefined;
  private guides: readonly SnapGuide[] = [];

  /**
   * Starts the mode.
   *
   * @param context - The document, undo grouping, callbacks and the index.
   */
  constructor(context: FrameModeContext) {
    this.context = context;
  }

  onPointer(input: ToolPointerInput): ToolStep {
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
    if (input.kind !== 'escape') return false;
    if (this.drag !== undefined) this.cancel();
    else this.context.requestExit();
    return true;
  }

  overlay(): Partial<SelectionOverlayModel> {
    return this.drag?.box === undefined ? {} : { guides: this.guides };
  }

  exit(): void {
    this.cancel();
  }

  /**
   * Starts a creation drag: its fixed corner is the press, snapped unless Shift or Alt is held.
   *
   * @param input - The press.
   */
  private press(input: PrimaryPointer): void {
    this.cancel();
    const anchor = this.snapped(input.world, input).point;
    this.drag = { press: input, anchor, id: this.context.environment.createId(), box: undefined };
  }

  /**
   * Follows the drag once it has moved past the click threshold: the box to the pointer,
   * previewed as the frame it will create.
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
    this.context.setPreview(drag.id, this.previewOf(drag.id, drag.box));
    this.context.onChange();
  }

  /**
   * Ends the press: creates the dragged frame, or a default one centred on a click.
   *
   * @param input - The release.
   * @returns Done once a frame was created, so the select tool takes over with it selected.
   */
  private release(input: PrimaryPointer): ToolStep {
    const { drag } = this;
    if (drag === undefined) return TOOL_STEP_CONTINUE;
    this.follow({ ...input, kind: 'pointerMove' });
    const box = drag.box ?? clickedFrameBox(drag.press.world);
    const created = this.create(box, drag.id);
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
   * Creates the frame and takes in what is inside it, as one command and one undo step; a
   * refusal is reported and nothing is created.
   *
   * @param box - The drawn box, world units.
   * @param id - The frame's id, the one its preview showed.
   * @returns The created frame's id, or undefined when the document refused it.
   */
  private create(box: ShapeBox, id: ObjectId): ObjectId | undefined {
    const { context } = this;
    const { board } = context;
    const placement =
      board === undefined
        ? { parentId: null, origin: { x: box.x, y: box.y }, rotation: 0, childIds: [] }
        : planFramePlacement(box, board);
    const frame = {
      ...this.frameFields(box),
      id,
      parentId: placement.parentId,
      x: placement.origin.x,
      y: placement.origin.y,
      rotation: placement.rotation,
    };
    let created: ObjectId | undefined;
    context.capture.command(() => {
      const { store, origin, environment } = context;
      const input = { frame, childIds: [...placement.childIds] };
      const outcome = runCommand(store, origin, createFrameCommand, input, environment);
      if (outcome.status === 'applied') created = outcome.result.id;
      else context.onCommandRefused?.(outcome.errors);
    });
    return created;
  }

  /**
   * The new frame's own fields for a box on the root: its box, the next default name, clipping
   * on and the white background.
   *
   * @param box - The box, world units.
   * @returns The fields.
   */
  private frameFields(box: ShapeBox) {
    return {
      type: 'frame' as const,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      name: nextFrameName(
        this.context.store.read().objects.values(),
        this.context.newFrameNamePrefix?.(),
      ),
      clip: true,
      background: NEW_FRAME_BACKGROUND,
    };
  }

  /**
   * The frame a drag previews: on the root at the drawn box, on top of everything.
   *
   * @param id - Its id.
   * @param box - Its box.
   * @returns The preview.
   */
  private previewOf(id: ObjectId, box: ShapeBox): FrameObject {
    const now = this.context.environment.clock();
    return {
      ...this.frameFields(box),
      id,
      parentId: null,
      rotation: 0,
      locked: false,
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
      snap: this.context.board,
      zoom: input.zoom,
      viewport: input.camera && visibleWorldBounds(input.camera),
    });
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
