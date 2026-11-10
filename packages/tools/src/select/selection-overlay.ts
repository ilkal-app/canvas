import {
  CameraUniform,
  visibleWorldBounds,
  InstanceBuffer,
  SOLID_RECT_PASS,
  ScenePassResources,
  type Frame,
  type FrameContext,
  type FrameStage,
  type GpuBackend,
  type ScenePass,
  type WorldBounds,
} from '@canvas/engine';

import { dashWindowOf } from './overlay-marks.js';
import { EMPTY_OVERLAY, overlayRectsOf, type SelectionOverlayModel } from './overlay-rects.js';
import { MAX_OUTLINED_OBJECTS } from './selection-outlines.js';

/** The name of the frame stage that draws the selection overlay, after `draw`. */
export const SELECTION_OVERLAY_STAGE_NAME = 'selectionOverlay';

/**
 * The overlay's pass: the solid-rect pass's pipeline and record layout (origin, size, rotation
 * axis, straight-alpha colour) under its own name. Its records are the overlay's rectangles,
 * not board objects, so it is never registered with the scene; `recordCount` and `prepare` are
 * the solid-rect pass's and unused.
 */
const OVERLAY_PASS: ScenePass = { ...SOLID_RECT_PASS, name: 'selection-overlay' };

/**
 * Whether two views are the same, or both absent.
 *
 * @param a - A view, world units.
 * @param b - Another.
 * @returns True when equal.
 */
function isSameBounds(a: WorldBounds | undefined, b: WorldBounds | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

/**
 * Draws the selection overlay: the frame's outline and handles, the
 * outlines of a multi-selection and the marquee, as flat rectangles through the solid-rect
 * pipeline in a render pass of their own after the scene's `draw` stage, over everything
 * (hence no z order). The rectangles are rebuilt only when the model or the zoom changes (line
 * widths and handle sizes follow the zoom), or, while a capped selection shows its count
 * badge, the view (the badge stays inside it), into a persistent instance buffer uploaded by
 * dirty ranges like the scene's; its own camera uniform tracks the frame's camera. Runs on the
 * thread that owns the backend.
 */
export class SelectionOverlay {
  private readonly instances = new InstanceBuffer(OVERLAY_PASS.layout, { initialCapacity: 64 });
  private readonly cameraUniform: CameraUniform;
  private readonly resources: ScenePassResources;
  private slots: readonly number[] = [];
  private readonly scratch = new Float32Array(OVERLAY_PASS.layout.floatsPerRecord);
  private model: SelectionOverlayModel = EMPTY_OVERLAY;
  private builtModel: SelectionOverlayModel | undefined;
  private builtZoom = Number.NaN;
  /** The view the rectangles were built for, while a count badge follows it. */
  private builtVisible: WorldBounds | undefined;
  /** The window a locked frame's dashes were cut in (`dashWindowOf`), while one is shown. */
  private builtDashWindow: WorldBounds | undefined;

  /**
   * Creates the overlay's GPU resources.
   *
   * @param backend - The backend the scene draws through.
   */
  constructor(backend: GpuBackend) {
    this.cameraUniform = new CameraUniform(backend);
    this.resources = new ScenePassResources(
      backend,
      OVERLAY_PASS,
      this.instances,
      this.cameraUniform,
    );
  }

  /**
   * How many rectangles the overlay drew in its last frame.
   *
   * @returns The count.
   */
  get rectCount(): number {
    return this.slots.length;
  }

  /**
   * Adds the overlay's stage to a frame, after `draw`.
   *
   * @param frame - The scene renderer's frame.
   * @throws {RangeError} When the frame has no `draw` stage or already has the overlay's.
   */
  install(frame: Frame): void {
    const stage: FrameStage = {
      name: SELECTION_OVERLAY_STAGE_NAME,
      run: (context) => {
        this.drawFrame(context);
      },
    };
    frame.insertTransientOverlay(stage);
  }

  /**
   * Sets what the overlay shows from the next frame on.
   *
   * @param model - The frame, handles, outlines and marquee.
   */
  setModel(model: SelectionOverlayModel): void {
    this.model = model;
  }

  /** Frees the overlay's GPU resources; the backend stays alive. */
  destroy(): void {
    this.resources.destroy();
    this.cameraUniform.destroy();
  }

  private drawFrame(context: FrameContext): void {
    this.rebuild(context.camera);
    // Nothing selected: no pass, and no upload either (released records are zeroed in the
    // buffer and reach the GPU with the next selection's upload), so an idle overlay costs a
    // frame nothing.
    if (this.slots.length === 0) return;
    if (this.cameraUniform.update(context.camera)) context.stats.bufferWrites += 1;
    this.resources.upload(context.stats);
    const renderPass = context.backend.beginRenderPass({});
    try {
      this.resources.draw(
        renderPass,
        [{ start: 0, count: this.instances.recordCount }],
        context.stats,
      );
    } finally {
      renderPass.end();
    }
  }

  private rebuild(camera: FrameContext['camera']): void {
    const { zoom } = camera;
    const { model } = this;
    const hasBadge =
      model.frame !== undefined &&
      (model.countBadge !== undefined || model.outlines.length > MAX_OUTLINED_OBJECTS);
    const visible = hasBadge ? visibleWorldBounds(camera) : undefined;
    // A locked frame's dashes are cut in a window round the view, which holds still
    // through a pan inside its margin: a camera-only frame rebuilds nothing then.
    const isDashed = model.frame !== undefined && model.isLocked && model.palette !== undefined;
    const dashWindow = isDashed ? dashWindowOf(visibleWorldBounds(camera)) : undefined;
    if (
      this.builtModel === model &&
      this.builtZoom === zoom &&
      isSameBounds(this.builtVisible, visible) &&
      isSameBounds(this.builtDashWindow, dashWindow)
    ) {
      return;
    }
    this.builtModel = model;
    this.builtZoom = zoom;
    this.builtVisible = visible;
    this.builtDashWindow = dashWindow;
    const rects = overlayRectsOf(model, zoom, visible, dashWindow);
    // Rectangles draw in slot order (a handle's white inside over its blue square), so the slots
    // stay 0, 1, 2, …: the unused tail is released highest first, since the buffer hands the
    // most recently released slot out first, and a later rebuild then gets them back in order.
    for (const slot of this.slots.slice(rects.length).reverse()) this.instances.release(slot);
    const placed = rects.map((rect, index) => ({
      rect,
      slot: this.slots[index] ?? this.instances.allocate(),
    }));
    this.slots = placed.map(({ slot }) => slot);
    const record = this.scratch;
    for (const { rect, slot } of placed) {
      const { box, color } = rect;
      record[0] = box.x;
      record[1] = box.y;
      record[2] = box.width;
      record[3] = box.height;
      record[4] = Math.cos(box.rotation);
      record[5] = Math.sin(box.rotation);
      record.set(color, 6);
      this.instances.write(slot, record);
    }
  }
}
