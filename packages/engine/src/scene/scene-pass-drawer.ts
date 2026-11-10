import type { MemoryCategory } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuRenderPass } from '../gpu/gpu-render-pass.js';
import type { MovePlacementBinding } from '../gpu/move-placement.js';

import type { CameraUniform } from './camera-uniform.js';
import type { ClipTableTexture } from './clip-table-texture.js';
import type { DrawListEntry } from './draw-list.js';
import type { FrameContext } from './frame-context.js';
import type { Frame } from './frame.js';
import type { InstanceBuffer } from './instance-buffer.js';

/** What a custom-draw pass's drawer is created with: the renderer's resources for the pass. */
export interface ScenePassDrawerSetup {
  /** The backend the renderer draws through. */
  readonly backend: GpuBackend;
  /** The pass's name, for labels and memory owners. */
  readonly passName: string;
  /** The pass's CPU instance buffer (the scene's): one record per object layer it draws. */
  readonly instances: InstanceBuffer;
  /** The camera uniform every scene pass binds at `@group(0) @binding(0)`. */
  readonly cameraUniform: CameraUniform;
  /**
   * The scene's clip table every scene pass binds at `@group(0) @binding(5)`; its
   * texture is replaced when the table grows, so a drawer's bind groups compare it by identity.
   */
  readonly clipTable: ClipTableTexture;
}

/** What {@link ScenePassDrawer.drawEntry} draws with. */
export interface EntryDrawContext {
  /** The frame being drawn. */
  readonly frame: FrameContext;
  /** The frame's open render pass; nothing may be written until it ends. */
  readonly renderPass: GpuRenderPass;
  /** The GPU copy of the pass's instance buffer, up to date for this frame. */
  readonly instanceBuffer: GpuBuffer;
}

/** GPU memory a drawer holds outside the pass's instance buffer. */
export interface DrawerMemory {
  /** The memory ledger category it counts under. */
  readonly category: MemoryCategory;
  /** Its size, bytes. */
  readonly bytes: number;
}

/**
 * The per-renderer drawing state of a pass that is not one instanced draw per range:
 * a path's stencil-then-cover fill and stroke are several draws of its own mesh per record. The
 * renderer creates one per such pass and asks it to draw every draw-list entry of that pass,
 * in the list's order, so z-order segments hold for it as for any pass. Runs on the rendering
 * thread; created and destroyed with the renderer.
 */
export interface ScenePassDrawer {
  /**
   * Selects retained absolute placements before drawing; undefined restores ordinary records.
   * The caller keeps resources alive until cleared. Absence refuses retained placement.
   *
   * @param placement - The current session's table and per-record indices, or undefined.
   */
  setMovePlacement?(placement: MovePlacementBinding | undefined): void;
  /**
   * Hooks into the renderer's frame: typically wraps `collectChanges` to see the change sets
   * and inserts a stage before `draw` that builds and uploads what the frame will draw (no
   * writes are allowed once the render pass is open). Called once, after the built-in stages,
   * the culler's hook and `zOrderSegments` are in place.
   *
   * @param frame - The renderer's frame.
   */
  install(frame: Frame): void;
  /**
   * Draws one draw-list entry of the pass inside the open render pass, adding its draws to
   * `context.frame.stats.drawCalls`.
   *
   * @param context - The frame, the open render pass and the GPU instance buffer.
   * @param entry - The entry: this pass's records to draw, in paint order.
   */
  drawEntry(context: EntryDrawContext, entry: DrawListEntry): void;
  /**
   * Whether the drawer has work in hand a later frame would show (meshes being built), so the
   * frame loop should draw again even if nothing else changed.
   *
   * @returns True while work is pending.
   */
  hasPendingWork(): boolean;
  /**
   * The GPU memory the drawer holds, for the memory ledger (`reportSceneMemory`).
   *
   * @returns Its category and size.
   */
  memory(): DrawerMemory;
  /** Frees everything the drawer created on the backend. */
  destroy(): void;
}
