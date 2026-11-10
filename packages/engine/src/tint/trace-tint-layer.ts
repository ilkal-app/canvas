import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { EngineOverlay } from '../host/engine-overlay.js';
import { CameraUniform } from '../scene/camera-uniform.js';
import type { FrameContext } from '../scene/frame-context.js';
import type { Frame } from '../scene/frame.js';
import { InstanceBuffer } from '../scene/instance-buffer.js';
import { ScenePassResources } from '../scene/scene-pass-resources.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';

import {
  EMPTY_TRACE_TINT,
  isTraceTintModel,
  traceTintRectsOf,
  type TraceTintModel,
} from './trace-tint-model.js';

/** The name of the frame stage that draws the trace tint, right after `draw`. */
export const TRACE_TINT_STAGE_NAME = 'traceTint';

/**
 * The tint's pass: the solid-rect pass's pipeline and record layout (origin, size, rotation
 * axis, straight-alpha colour) under its own name. Its records are the tint's rectangles, not
 * board objects, so it is never registered with the scene.
 */
const TINT_PASS: ScenePass = { ...SOLID_RECT_PASS, name: 'trace-tint' };

/**
 * Draws the trace sheets' tint (Figma `04 · Agent working — trace sheet`): per open
 * sheet, a translucent fill in the agent's colour over the objects on it and an outline round
 * them, through the solid-rect pipeline in a render pass of its own after the scene's `draw`
 * stage, as a transient overlay (excluded from document-preview certificates). The rectangles
 * are rebuilt only when the model, the zoom or the pixel ratio changes (padding and outline keep
 * their screen size), into a persistent instance buffer uploaded by dirty ranges; a pan writes only the
 * tint's camera uniform, and with no sheet open the tint writes and draws nothing at all. Runs
 * on the thread that owns the backend.
 */
export class TraceTintLayer {
  private readonly instances = new InstanceBuffer(TINT_PASS.layout, { initialCapacity: 16 });
  private readonly cameraUniform: CameraUniform;
  private readonly resources: ScenePassResources;
  private readonly scratch = new Float32Array(TINT_PASS.layout.floatsPerRecord);
  private slots: readonly number[] = [];
  private model: TraceTintModel = EMPTY_TRACE_TINT;
  private builtModel: TraceTintModel | undefined;
  private builtZoom = Number.NaN;
  private builtDpr = Number.NaN;

  /**
   * Creates the tint's GPU resources.
   *
   * @param backend - The backend the scene draws through.
   */
  constructor(backend: GpuBackend) {
    this.cameraUniform = new CameraUniform(backend);
    this.resources = new ScenePassResources(backend, TINT_PASS, this.instances, this.cameraUniform);
  }

  /**
   * How many rectangles the tint drew in its last frame.
   *
   * @returns The count: five per sheet.
   */
  get rectCount(): number {
    return this.slots.length;
  }

  /**
   * Adds the tint's stage to a frame, right after `draw`, as a transient overlay: a layer
   * installed earlier (the selection overlay) then runs after it, so draws over it.
   *
   * @param frame - The scene renderer's frame.
   * @throws {RangeError} When the frame has no `draw` stage or already has the tint's.
   */
  install(frame: Frame): void {
    frame.insertTransientOverlay({
      name: TRACE_TINT_STAGE_NAME,
      run: (context) => {
        this.drawFrame(context);
      },
    });
  }

  /**
   * Sets what the tint shows from the next frame on.
   *
   * @param model - The open sheets.
   */
  setModel(model: TraceTintModel): void {
    this.model = model;
  }

  /** Frees the tint's GPU resources; the backend stays alive. */
  destroy(): void {
    this.resources.destroy();
    this.cameraUniform.destroy();
  }

  private drawFrame(context: FrameContext): void {
    this.rebuild(context.camera.zoom, context.camera.dpr);
    // No sheet: no pass and no upload, so an idle tint costs a frame nothing.
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

  private rebuild(zoom: number, dpr: number): void {
    if (this.builtModel === this.model && this.builtZoom === zoom && this.builtDpr === dpr) return;
    this.builtModel = this.model;
    this.builtZoom = zoom;
    this.builtDpr = dpr;
    const rects = traceTintRectsOf(this.model, zoom, dpr);
    // Rectangles draw in slot order (a sheet's fill under its outline), so the slots stay
    // 0, 1, 2, …: the unused tail is released highest first, as the selection overlay does.
    for (const slot of this.slots.slice(rects.length).reverse()) this.instances.release(slot);
    const slots = rects.map((rect, index) => this.slots[index] ?? this.instances.allocate());
    this.slots = slots;
    const record = this.scratch;
    rects.forEach((rect, index) => {
      record[0] = rect.x;
      record[1] = rect.y;
      record[2] = rect.width;
      record[3] = rect.height;
      record[4] = 1;
      record[5] = 0;
      record.set(rect.color, 6);
      this.instances.write(slots[index] ?? 0, record);
    });
  }
}

/**
 * The trace tint ({@link TraceTintLayer}) as an engine host's overlay layer (`EngineOverlay`):
 * the app combines it with the selection overlay through `layerOverlays`, where the engine
 * renders (the app's engine worker script, or the main-thread host). A model that is not a
 * `TraceTintModel` is refused (the host reports it as a fault). Runs on the thread that renders.
 *
 * @param backend - The host's backend.
 * @returns The layer.
 */
export function createTraceTintLayer(backend: GpuBackend): EngineOverlay {
  const tint = new TraceTintLayer(backend);
  return {
    install: (frame) => {
      tint.install(frame);
    },
    setModel: (model) => {
      if (!isTraceTintModel(model)) return false;
      tint.setModel(model);
      return true;
    },
    destroy: () => {
      tint.destroy();
    },
  };
}
