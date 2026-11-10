import type { Gradient, ObjectId } from '@canvas/schema';

import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { GpuBindingLayoutEntry } from '../gpu/gpu-pipeline.js';
import type { Frame } from '../scene/frame.js';
import type { SceneObject, ScenePass, ScenePassEnvironment } from '../scene/scene-pass.js';

import { PaintTable } from './paint-table.js';

/** The binding the gradient shaders read the paint table at, after the camera's 0. */
export const PAINT_TABLE_BINDING = 1;

/** The gradient variants' page bindings: the paint table, load-only. */
export const PAINT_TABLE_BINDINGS: readonly GpuBindingLayoutEntry[] = Object.freeze([
  { binding: PAINT_TABLE_BINDING, kind: 'load-texture' as const },
]);

/** The built-in gradient shape and frame-background passes, whose records are always ready. */
const readyPasses = new WeakSet<ScenePass>();

/**
 * Marks a built-in gradient pass whose drawing needs nothing but its records and the paint
 * table, both written synchronously: a preview may certify it as it does the solid passes.
 *
 * @param pass - The pass.
 * @returns The pass.
 */
export function markPaintTablePass(pass: ScenePass): ScenePass {
  readyPasses.add(pass);
  return pass;
}

/**
 * Whether a pass is a built-in gradient pass ({@link markPaintTablePass}).
 *
 * @param pass - The pass.
 * @returns True for one.
 */
export function isPaintTablePass(pass: ScenePass): boolean {
  return readyPasses.has(pass);
}

/** One renderer's paint table and how many of its passes hold it. */
interface SharedTable {
  readonly table: PaintTable;
  holders: number;
}

/** Each renderer's table, by the environment its passes are built with (one per renderer). */
const tables = new WeakMap<ScenePassEnvironment, SharedTable>();

/**
 * One gradient variant pass's side of the scene's paint table: the table is
 * one per renderer, shared by the shape, path and frame-background variants (keyed by the
 * environment `resolveScenePasses` builds them all with) and freed with the last of them. Each
 * object's record is written when the pass prepares it and freed when the pass forgets it; the
 * pass's wrap of `uploadDirtyRanges` rewrites the records of objects whose level of detail changed (a gradient
 * under the threshold draws its average colour, record index 0) and uploads the table's dirty
 * records before the instance ranges, so a frame with no paint change uploads nothing.
 */
export class GradientRecords {
  /** The renderer's paint table. */
  readonly table: PaintTable;
  private readonly targets = new Map<ObjectId, SceneObject>();
  private readonly rewrites = new Set<SceneObject>();
  private entries: readonly GpuBindGroupEntry[] = [];
  private isDestroyed = false;

  /**
   * Joins the renderer's paint table, creating it for the first gradient pass.
   *
   * @param passName - The pass's name, for its level of detail and its stage.
   * @param environment - The renderer's environment.
   * @param cheapForm - The level-of-detail form in which the pass draws the average colour.
   */
  constructor(
    private readonly passName: string,
    private readonly environment: ScenePassEnvironment,
    private readonly cheapForm: string,
  ) {
    let shared = tables.get(environment);
    if (shared === undefined) {
      shared = { table: new PaintTable(environment.backend), holders: 0 };
      tables.set(environment, shared);
    }
    shared.holders += 1;
    this.table = shared.table;
  }

  /**
   * Writes an object's gradient and keeps its target for level-of-detail rewrites.
   *
   * @param target - The object as the pass prepares it.
   * @param gradient - Its gradient.
   * @returns The record index the instance holds, or 0 when it draws its average colour.
   */
  rowOf(target: SceneObject, gradient: Gradient): number {
    const { id } = target.object;
    this.targets.set(id, target);
    const row = this.table.write(id, gradient);
    return this.isCheap(id) ? 0 : row;
  }

  /**
   * Whether an object draws in its cheap form: its paint's average colour.
   *
   * @param id - The object.
   * @returns True below the level-of-detail threshold.
   */
  isCheap(id: ObjectId): boolean {
    return this.environment.levelOfDetail?.formOf(this.passName, id) === this.cheapForm;
  }

  /**
   * Frees an object's record.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    this.targets.delete(id);
    this.table.release(id);
  }

  /**
   * The page entries binding the paint table: the same array while the texture stays the same.
   *
   * @returns The entries.
   * @throws {Error} When asked before the table has a texture (no gradient was flushed).
   */
  pageEntries(): readonly GpuBindGroupEntry[] {
    const { texture } = this.table;
    if (texture === undefined) throw new Error('The paint table has no texture yet.');
    const [current] = this.entries;
    if (current === undefined || !('texture' in current) || current.texture !== texture) {
      this.entries = [{ binding: PAINT_TABLE_BINDING, texture }];
    }
    return this.entries;
  }

  /**
   * Wraps `uploadDirtyRanges` (so the frame's stages keep their names): before the ranges
   * upload, rewrites the records whose level of detail changed, then uploads the table's dirty
   * records.
   *
   * @param frame - The renderer's frame.
   */
  install(frame: Frame): void {
    frame.wrapStage('uploadDirtyRanges', (inner) => ({
      name: inner.name,
      run: (context) => {
        for (const id of context.scene.levelOfDetail.changedIn(this.passName)) {
          const target = this.targets.get(id);
          if (target !== undefined) this.rewrites.add(target);
        }
        if (this.rewrites.size > 0) context.scene.rewriteRecords(this.passName, this.rewrites);
        this.rewrites.clear();
        const upload = this.table.flush();
        context.stats.uploadedBytes += upload.uploadedBytes;
        context.stats.bufferWrites += upload.writes;
        inner.run(context);
      },
    }));
  }

  /**
   * Reports the table's texture under `textures` (each variant reports the same owner).
   *
   * @param ledger - The frame statistics' ledger.
   */
  reportMemory(ledger: MemoryLedger): void {
    ledger.set('textures', 'paint-table', this.table.byteLength);
  }

  /** Leaves the table, freeing its texture with the last pass that held it. */
  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    const shared = tables.get(this.environment);
    if (shared === undefined) return;
    shared.holders -= 1;
    if (shared.holders > 0) return;
    shared.table.destroy();
    tables.delete(this.environment);
  }
}
