import {
  croppedImageBox,
  runCommand,
  setStyleCommand,
  type CommandEnvironment,
  type CommandError,
  type DocumentStore,
  type StylePatch,
  type TransactionOrigin,
} from '@canvas/document';
import type { BoardObject, Crop, ImageObject, ObjectId, Point } from '@canvas/schema';

import {
  TOOL_STEP_CONTINUE,
  type ToolCursor,
  type ToolKeyInput,
  type ToolMode,
  type ToolPointerInput,
  type ToolStep,
} from '../modes/tool-mode.js';
import { hitHandle } from '../select/handle-layout.js';
import { isInsideBox, worldPointToBox, type OrientedBox } from '../select/oriented-box.js';
import type { SelectionOverlayModel } from '../select/overlay-rects.js';
import type { NudgeDirection, SelectPointerType } from '../select/select-input.js';

import {
  cropDeltaOf,
  cropFrameOf,
  dragCrop,
  isSameCrop,
  MIN_CROP_SIDE_PX,
  type CropHandle,
} from './crop-geometry.js';
import { cropOverlayRects } from './crop-overlay.js';

/** The whole image, uncropped. */
const WHOLE_IMAGE: Crop = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

/** How far an arrow key moves the focused crop edge, CSS px on screen; with Shift, ten times. */
export const CROP_NUDGE_PX = 1;

/** How far Shift and an arrow key move the focused crop edge, CSS px on screen. */
export const CROP_NUDGE_LARGE_PX = 10;

/**
 * The order select all (the key crop mode otherwise takes unused) moves the keyboard's focus
 * through: the handles clockwise from the top-left, then the whole box.
 */
export const CROP_FOCUS_ORDER: readonly CropHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'inside',
];

/** Each arrow's direction along the image's own axes. */
const NUDGE_AXES: Readonly<Record<NudgeDirection, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * What the crop mode works on and reports to: the document it writes the crop to, how its one
 * command joins the undo history, the preview it shows the whole image with, and the router's
 * callbacks. The app's engine document gives it from the tool modes' services. Main thread.
 */
export interface CropModeContext {
  /** The document; the crop is written only through `setStyle`. */
  readonly store: DocumentStore;
  /** Who the command is attributed to. */
  readonly origin: TransactionOrigin;
  /** The command clock and id generator. */
  readonly environment: CommandEnvironment;
  /**
   * Runs the crop's command as its own undo step, apart from any typing (the app's typing undo
   * policy); the command runs as it is when absent.
   */
  readonly capture?: {
    /**
     * Runs an edit's command as its own undo step.
     *
     * @param run - Runs the command.
     */
    command(run: () => void): void;
  };
  /** Shows an object as previewed without writing it, or drops the preview. */
  readonly setPreview: (id: ObjectId, object: BoardObject | undefined) => void;
  /** Called when what the mode shows changed. */
  readonly onChange: () => void;
  /** Ends the mode from inside it: back to the select tool. */
  readonly requestExit: () => void;
  /** Receives the errors when the document refuses the crop (the image locked or deleted). */
  readonly onCommandRefused?: (errors: readonly CommandError[]) => void;
}

/**
 * What a crop mode crops: an image object's own crop, or an image fill's. It shows the
 * draft as it changes and says which style one commit writes.
 */
export interface CropTarget {
  /** The object the crop is written to. */
  readonly id: ObjectId;
  /** Its crop as stored, where the draft starts. */
  readonly crop: Crop;
  /**
   * Shows a draft crop (nothing is written); called on entering and whenever the draft changes.
   *
   * @param draft - The crop as dragged so far.
   */
  show(draft: Crop): void;
  /** Drops what {@link CropTarget.show} showed. */
  hide(): void;
  /**
   * The style one commit writes for a crop, read when it commits; undefined when the crop no
   * longer applies (an image fill replaced or removed meanwhile), and nothing is written.
   *
   * @param crop - The crop.
   * @returns The style patch, or undefined.
   */
  styleOf(crop: Crop): StylePatch | undefined;
}

/**
 * An image object's own crop: its whole image shows while cropping (the box grows to the
 * whole image, a preview, shown once), and a commit writes `crop`, the box following it.
 *
 * @param context - The mode's context, for the preview.
 * @param image - The image as stored.
 * @returns The target.
 */
function imageCropTarget(context: CropModeContext, image: ImageObject): CropTarget {
  let isShown = false;
  return {
    id: image.id,
    crop: image.crop,
    // The whole image shows once; the overlay alone follows the draft.
    show: () => {
      if (isShown) return;
      isShown = true;
      context.setPreview(image.id, {
        ...image,
        crop: WHOLE_IMAGE,
        ...croppedImageBox(image, WHOLE_IMAGE),
      });
    },
    hide: () => {
      context.setPreview(image.id, undefined);
    },
    styleOf: (crop) => ({ crop: { ...crop } }),
  };
}

/** A crop drag under way. */
interface CropDrag {
  /** What is dragged. */
  readonly handle: CropHandle;
  /** The crop when the drag started. */
  readonly start: Crop;
  /** Where it started, in the whole image's own frame, world units. */
  readonly from: Point;
}

/**
 * The crop mode, entered by activating an image (a double-click on it, Enter with it alone
 * selected, or the image section's Crop button): the whole image shows (a preview; nothing is
 * written), dimmed outside the crop box, with the crop box's eight handles. A handle drags the
 * crop's edges and the box pans the crop, within the image and never below 16 CSS px; nothing is
 * written while dragging. From the keyboard, the arrows move the focused handle's edges (the handle
 * last pressed, the bottom-right one at first; drawn filled) by a CSS pixel, ten with Shift, or pan
 * the crop when the box has the focus, and select all moves the focus on (`CROP_FOCUS_ORDER`).
 * Enter, a press outside the image (which the select tool then takes), or leaving the mode any
 * other way commits the crop as one `setStyle` of `crop` (one undo step, the box following it:
 * `croppedImageBox`); Escape cancels and writes nothing. A cancelled pointer puts back the crop of
 * the drag's start. Shows under the select tool's name, as vector editing does. Main thread; no
 * DOM.
 */
export class CropMode implements ToolMode {
  readonly id = 'select' as const;
  private readonly context: CropModeContext;
  private readonly target: CropTarget;
  /** The whole image on the board, world units. */
  private readonly full: OrientedBox;
  private draft: Crop;
  private drag: CropDrag | undefined;
  private zoom = 1;
  private isCancelled = false;
  private hovered: CropHandle | undefined;
  /** What the arrow keys move: the handle last pressed, the bottom-right one at first. */
  private focus: CropHandle = 'se';

  /**
   * Starts cropping: shows the whole image.
   *
   * @param context - The document, the preview and the router's callbacks.
   * @param subject - The image as stored, or another crop target (an image fill's).
   * @param full - The whole image on the board (`fullImageFrame` of an image's box), world units.
   */
  constructor(context: CropModeContext, subject: ImageObject | CropTarget, full: OrientedBox) {
    this.context = context;
    this.target = 'type' in subject ? imageCropTarget(context, subject) : subject;
    this.full = full;
    this.draft = this.target.crop;
    this.target.show(this.draft);
  }

  /**
   * The crop as dragged so far, fractions of the natural size.
   *
   * @returns The crop.
   */
  get crop(): Crop {
    return this.draft;
  }

  /**
   * `move` while dragging or over the crop box, `pointer` over a handle, `default` elsewhere.
   *
   * @returns The cursor.
   */
  get cursor(): ToolCursor {
    const handle = this.drag?.handle ?? this.hovered;
    if (handle === undefined) return 'default';
    return handle === 'inside' || this.drag !== undefined ? 'move' : 'pointer';
  }

  onPointer(input: ToolPointerInput): ToolStep {
    switch (input.kind) {
      case 'pointerDown':
        return this.press(input.world, input.zoom, input.pointerType);
      case 'pointerMove': {
        this.zoom = input.zoom;
        const { drag } = this;
        if (drag === undefined) this.hovered = this.handleAt(input.world, input.pointerType);
        else this.move(drag, input.world);
        return TOOL_STEP_CONTINUE;
      }
      case 'pointerUp':
        this.drag = undefined;
        return TOOL_STEP_CONTINUE;
      case 'pointerCancel':
        if (this.drag !== undefined) this.setDraft(this.drag.start);
        this.drag = undefined;
        return TOOL_STEP_CONTINUE;
      default:
        return TOOL_STEP_CONTINUE;
    }
  }

  onKey(input: ToolKeyInput): boolean {
    if (input.kind === 'escape') this.isCancelled = true;
    if (input.kind === 'escape' || input.kind === 'enter') this.context.requestExit();
    if (input.kind === 'nudge') this.nudge(input.direction, input.isLarge);
    if (input.kind === 'selectAll') {
      const index = CROP_FOCUS_ORDER.indexOf(this.focus);
      this.focus = CROP_FOCUS_ORDER[(index + 1) % CROP_FOCUS_ORDER.length] ?? 'se';
    }
    if (input.kind === 'nudge' || input.kind === 'selectAll') this.context.onChange();
    // Delete would act on the image behind the crop: taken, unused.
    return true;
  }

  /**
   * The handle or box the arrow keys move now.
   *
   * @returns It.
   */
  get focusedHandle(): CropHandle {
    return this.focus;
  }

  overlay(): Partial<SelectionOverlayModel> {
    return {
      frame: undefined,
      outlines: [],
      countBadge: undefined,
      canResize: false,
      toolRects: cropOverlayRects(this.full, this.draft, this.zoom, this.focus),
    };
  }

  onZoom(zoom: number): void {
    this.zoom = zoom;
  }

  exit(): void {
    this.drag = undefined;
    if (!this.isCancelled && !isSameCrop(this.draft, this.target.crop)) this.commit();
    this.target.hide();
  }

  abandon(): void {
    this.isCancelled = true;
    this.exit();
  }

  /**
   * A press: on a handle or the crop box, a drag starts; outside the whole image, the crop is
   * done and the select tool takes the press; on the dimmed image, nothing.
   *
   * @param world - The press, world units.
   * @param zoom - The camera zoom, CSS px per world unit.
   * @param pointerType - The pointer, which sizes the handles' squares.
   * @returns The step.
   */
  private press(world: Point, zoom: number, pointerType?: SelectPointerType): ToolStep {
    this.zoom = zoom;
    const handle = this.handleAt(world, pointerType);
    if (handle !== undefined) {
      this.focus = handle;
      this.drag = { handle, start: this.draft, from: worldPointToBox(this.full, world) };
      return TOOL_STEP_CONTINUE;
    }
    if (isInsideBox(this.full, world)) return TOOL_STEP_CONTINUE;
    return { isDone: true, isPassedOn: true };
  }

  /**
   * The handle or crop box under a point, if any.
   *
   * @param world - The point, world units.
   * @param pointerType - The pointer.
   * @returns What a press there would drag.
   */
  private handleAt(world: Point, pointerType?: SelectPointerType): CropHandle | undefined {
    const box = cropFrameOf(this.full, this.draft);
    const handle = hitHandle(box, this.zoom, world, true, pointerType);
    return handle ?? (isInsideBox(box, world) ? 'inside' : undefined);
  }

  /**
   * Follows a drag: the crop from the drag's start, moved by the pointer.
   *
   * @param drag - The drag.
   * @param world - The pointer, world units.
   */
  private move(drag: CropDrag, world: Point): void {
    const { full } = this;
    const delta = cropDeltaOf(full, drag.from, worldPointToBox(full, world));
    const side = MIN_CROP_SIDE_PX / this.zoom;
    const minimum = { width: side / full.width, height: side / full.height };
    this.setDraft(dragCrop(drag.start, drag.handle, delta, minimum));
  }

  /**
   * Moves the focused handle's edges (or pans the crop, for the box) by an arrow key: one CSS
   * pixel on screen, ten with Shift, along the image's own axes, within the image and never
   * below the smallest crop.
   *
   * @param direction - The arrow.
   * @param isLarge - Whether Shift was held.
   */
  private nudge(direction: NudgeDirection, isLarge: boolean): void {
    const { full } = this;
    const step = (isLarge ? CROP_NUDGE_LARGE_PX : CROP_NUDGE_PX) / this.zoom;
    const axis = NUDGE_AXES[direction];
    const delta = { x: (axis.x * step) / full.width, y: (axis.y * step) / full.height };
    const side = MIN_CROP_SIDE_PX / this.zoom;
    const minimum = { width: side / full.width, height: side / full.height };
    this.setDraft(dragCrop(this.draft, this.focus, delta, minimum));
  }

  /**
   * Takes a new draft crop and shows it.
   *
   * @param draft - The crop.
   */
  private setDraft(draft: Crop): void {
    this.draft = draft;
    this.target.show(draft);
  }

  /**
   * Writes the crop as one `setStyle`, its own undo step; a refusal is reported. Nothing when the
   * target says the crop no longer applies.
   */
  private commit(): void {
    const { context, target, draft } = this;
    const style = target.styleOf(draft);
    if (style === undefined) return;
    const run = () => {
      const { store, origin, environment } = context;
      const input = { changes: [{ id: target.id, style }] };
      const outcome = runCommand(store, origin, setStyleCommand, input, environment);
      if (outcome.status === 'rejected') context.onCommandRefused?.(outcome.errors);
    };
    if (context.capture === undefined) run();
    else context.capture.command(run);
  }
}
