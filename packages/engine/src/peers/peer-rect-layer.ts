import type { GpuBackend } from '../gpu/gpu-backend.js';
import { CameraUniform } from '../scene/camera-uniform.js';
import type { FrameContext } from '../scene/frame-context.js';
import type { Frame } from '../scene/frame.js';
import { InstanceBuffer } from '../scene/instance-buffer.js';
import { ScenePassResources } from '../scene/scene-pass-resources.js';
import type { ScenePass } from '../scene/scene-pass.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';

import type { PeerEditingRect } from './peer-editing-model.js';

/** What a {@link PeerRectLayer} draws, and from what. */
export interface PeerRectLayerOptions<M> {
  /** The pass's name, the label of its buffers' writes. */
  readonly passName: string;
  /** The frame stage's name, right after `draw`. */
  readonly stageName: string;
  /** The model it starts with, which draws nothing. */
  readonly empty: M;
  /**
   * The rectangles that draw a model at a zoom and pixel ratio, in drawing order. Pure.
   *
   * @param model - The model.
   * @param zoom - The camera zoom.
   * @param dpr - Device pixels per CSS pixel.
   * @returns The rectangles.
   */
  readonly rectsOf: (model: M, zoom: number, dpr: number) => readonly PeerEditingRect[];
}

/**
 * A transient overlay of flat, turned rectangles in the peers' colours ('s peer editing
 * marks,'s peer selections): drawn through the solid-rect pipeline under a pass name of
 * its own, in a render pass of its own right after the scene's `draw` stage, excluded from
 * document-preview certificates. The rectangles are rebuilt only when the model, the zoom or the
 * pixel ratio changes (the marks keep their screen widths), into a persistent instance buffer
 * uploaded by dirty ranges; a pan writes only the layer's camera uniform, and with nothing to
 * draw it writes and draws nothing at all. Runs on the thread that owns the backend.
 */
export class PeerRectLayer<M> {
  private readonly pass: ScenePass;
  private readonly instances: InstanceBuffer;
  private readonly cameraUniform: CameraUniform;
  private readonly resources: ScenePassResources;
  private readonly scratch: Float32Array;
  private readonly options: PeerRectLayerOptions<M>;
  private slots: readonly number[] = [];
  private model: M;
  private builtModel: M | undefined;
  private builtZoom = Number.NaN;
  private builtDpr = Number.NaN;

  /**
   * Creates the layer's GPU resources.
   *
   * @param backend - The backend the scene draws through.
   * @param options - Its names, its empty model and how a model becomes rectangles.
   */
  constructor(backend: GpuBackend, options: PeerRectLayerOptions<M>) {
    this.options = options;
    this.model = options.empty;
    this.pass = { ...SOLID_RECT_PASS, name: options.passName };
    this.instances = new InstanceBuffer(this.pass.layout, { initialCapacity: 16 });
    this.scratch = new Float32Array(this.pass.layout.floatsPerRecord);
    this.cameraUniform = new CameraUniform(backend);
    this.resources = new ScenePassResources(backend, this.pass, this.instances, this.cameraUniform);
  }

  /**
   * How many rectangles the layer drew in its last frame.
   *
   * @returns The count.
   */
  get rectCount(): number {
    return this.slots.length;
  }

  /**
   * Adds the layer's stage to a frame, right after `draw`, as a transient overlay: a layer
   * installed earlier then runs after it, so draws over it.
   *
   * @param frame - The scene renderer's frame.
   * @throws {RangeError} When the frame has no `draw` stage or already has the layer's.
   */
  install(frame: Frame): void {
    frame.insertTransientOverlay({
      name: this.options.stageName,
      run: (context) => {
        this.drawFrame(context);
      },
    });
  }

  /**
   * Sets what the layer shows from the next frame on.
   *
   * @param model - The model.
   */
  setModel(model: M): void {
    this.model = model;
  }

  /** Frees the layer's GPU resources; the backend stays alive. */
  destroy(): void {
    this.resources.destroy();
    this.cameraUniform.destroy();
  }

  private drawFrame(context: FrameContext): void {
    this.rebuild(context.camera.zoom, context.camera.dpr);
    // Nothing to draw: no pass and no upload, so the layer at rest costs a frame nothing.
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
    const rects = this.options.rectsOf(this.model, zoom, dpr);
    // Rectangles draw in slot order, so the slots stay 0, 1, 2, …: the unused tail is released
    // highest first, as the selection overlay does.
    for (const slot of this.slots.slice(rects.length).reverse()) this.instances.release(slot);
    const slots = rects.map((rect, index) => this.slots[index] ?? this.instances.allocate());
    this.slots = slots;
    const record = this.scratch;
    rects.forEach((rect, index) => {
      record[0] = rect.x;
      record[1] = rect.y;
      record[2] = rect.width;
      record[3] = rect.height;
      record[4] = rect.cos;
      record[5] = rect.sin;
      record.set(rect.color, 6);
      this.instances.write(slots[index] ?? 0, record);
    });
  }
}
