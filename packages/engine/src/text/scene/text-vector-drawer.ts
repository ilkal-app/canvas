import type { ObjectId } from '@canvas/schema';
import type { TextLayout } from '@canvas/text';

import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBuffer } from '../../gpu/gpu-buffer.js';
import type { MovePlacementBinding } from '../../gpu/move-placement.js';
import type { DrawListEntry } from '../../scene/draw-list.js';
import type { FrameContext } from '../../scene/frame-context.js';
import type { Frame } from '../../scene/frame.js';
import type {
  DrawerMemory,
  EntryDrawContext,
  ScenePassDrawer,
  ScenePassDrawerSetup,
} from '../../scene/scene-pass-drawer.js';
import type { ScenePass } from '../../scene/scene-pass.js';
import { buildVectorRunMesh } from '../vector/vector-run-mesh.js';
import {
  createVectorTextPipelines,
  destroyVectorTextPipelines,
  vectorCoverQuad,
  type VectorTextPipelines,
} from '../vector/vector-text-pipelines.js';

import { textOriginOf } from './text-placement.js';
import type { DrawnText, TextVectorState } from './text-vector-state.js';

/** One drawn run's mesh on the GPU. */
interface RunMesh {
  /** What it was built from: rebuilt when the text's layout or box moves within the object. */
  readonly layout: TextLayout;
  readonly originX: number;
  readonly originY: number;
  /** The glyph triangles, `GLYPH_STENCIL_VERTEX_LAYOUT`. */
  readonly stencil: GpuBuffer;
  readonly vertexCount: number;
  /** The cover quad, `VECTOR_COVER_VERTEX_LAYOUT`. */
  readonly cover: GpuBuffer;
  /** The edge hulls, `GLYPH_EDGE_VERTEX_LAYOUT`; none when no glyph has them. */
  readonly edges: GpuBuffer | undefined;
  readonly edgeVertexCount: number;
  /** Its GPU bytes. */
  readonly bytes: number;
}

/**
 * How far the cover quad reaches past a run's glyphs, em: its cleanup must clear every
 * sample the edge hulls marked, and they reach a device pixel past the glyphs. The vector tier
 * draws text from 460 device px per em (512 less its hysteresis), so a pixel is under 1/460 em.
 */
const COVER_REACH_EM = 1 / 256;

/** A run the text pass draws from its outlines, by the slot of its record. */
interface DrawnRun {
  readonly id: ObjectId;
  readonly run: number;
  readonly text: DrawnText;
}

/** The GPU bytes of run meshes kept for runs not on screen by default, newest kept first. */
export const VECTOR_MESH_BUDGET_BYTES = 16 * 1024 * 1024;

/** Bytes of a cover quad: six vertices of x, y. */
const COVER_BYTES = 48;

/**
 * Draws the runs the text pass draws from their outlines: per run, its glyph triangles
 * into the stencil, its edge hulls with their analytic coverage, its cover quad over
 * the rest, and the quad again to clear the hulls' marks, all at the run's record. A run's mesh is built
 * in its object's frame when it is first on screen, from the glyphs' cached geometry, and kept
 * while its layout and box stay the same, newest first within a byte budget. With no run drawn
 * so, a frame costs nothing. The thread that renders.
 */
export class TextVectorDrawer implements ScenePassDrawer {
  private readonly backend: GpuBackend;
  private readonly passName: string;
  private readonly pipelines: VectorTextPipelines;
  private move: { placement: MovePlacementBinding; pipelines: VectorTextPipelines } | undefined;
  /** Every run drawn from its outlines, by its record's slot: rebuilt when either changes. */
  private readonly runsBySlot = new Map<number, DrawnRun>();
  private runsVersion = -1;
  /** The scene's slot ownership the map was built at. */
  private runsSlotRevision = -1;
  /** The vector state's geometry generation the meshes were built from. */
  private meshGeneration = 0;
  /** Meshes by `id#run`, least recently drawn first. */
  private readonly meshes = new Map<string, RunMesh>();
  private meshBytes = 0;
  /** This frame's on-screen runs' meshes, by slot. */
  private readonly frameMeshes = new Map<number, RunMesh>();

  /**
   * Creates the drawer's pipelines.
   *
   * @param setup - The renderer's backend, instance buffer, camera uniform and clip table.
   * @param pass - The companion pass, for its record layout.
   * @param state - The text pass's vector state: which runs draw from their outlines.
   * @param meshBudgetBytes - The bytes of meshes kept for runs not on screen.
   */
  constructor(
    private readonly setup: ScenePassDrawerSetup,
    private readonly pass: ScenePass,
    private readonly state: TextVectorState,
    private readonly meshBudgetBytes = VECTOR_MESH_BUDGET_BYTES,
  ) {
    this.backend = setup.backend;
    this.passName = setup.passName;
    this.pipelines = this.createPipelines(undefined);
  }

  /**
   * Builds this frame's on-screen runs' meshes before any entry is drawn, layers included.
   *
   * @param frame - The renderer's frame.
   */
  install(frame: Frame): void {
    // Before the offscreen layers when the renderer draws them, else before the canvas.
    const anchor = frame.stageNames.includes('layers') ? 'layers' : 'draw';
    frame.insertStage('before', anchor, {
      name: `${this.passName}Meshes`,
      run: (context) => {
        this.prepare(context);
      },
    });
  }

  /**
   * Draws with the session's retained placements, or the records again.
   *
   * @param placement - Borrowed table and indices; undefined restores ordinary records.
   */
  setMovePlacement(placement: MovePlacementBinding | undefined): void {
    if (placement?.table !== this.move?.placement.table) {
      if (this.move) destroyVectorTextPipelines(this.move.pipelines);
      this.move = placement && { placement, pipelines: this.createPipelines(placement) };
    } else if (this.move && placement) {
      this.move = { ...this.move, placement };
    }
  }

  /**
   * Draws an entry's runs drawn from their outlines, in slot order: per run a stencil draw of its
   * glyph triangles, then its cover quad.
   *
   * @param context - The frame, the open render pass and the GPU instance buffer.
   * @param entry - The entry.
   */
  drawEntry(context: EntryDrawContext, entry: DrawListEntry): void {
    const { frameMeshes } = this;
    if (frameMeshes.size === 0) return;
    const runs: (readonly [slot: number, mesh: RunMesh])[] = [];
    for (const { start, count } of entry.ranges) {
      // Whichever is fewer: the range's slots, or this frame's meshes.
      if (count <= frameMeshes.size) {
        for (let slot = start; slot < start + count; slot += 1) {
          const mesh = frameMeshes.get(slot);
          if (mesh !== undefined) runs.push([slot, mesh]);
        }
        continue;
      }
      const inRange: (readonly [slot: number, mesh: RunMesh])[] = [];
      for (const run of frameMeshes) {
        if (run[0] >= start && run[0] < start + count) inRange.push(run);
      }
      runs.push(...inRange.sort(([a], [b]) => a - b));
    }
    const { renderPass, instanceBuffer } = context;
    const pipelines = this.move?.pipelines ?? this.pipelines;
    let isBound = false;
    for (const [slot, mesh] of runs) {
      renderPass.setPipeline(pipelines.count);
      if (!isBound) {
        renderPass.setBindGroup(pipelines.bindGroup);
        renderPass.setVertexBuffer(1, instanceBuffer);
        if (this.move) renderPass.setVertexBuffer(2, this.move.placement.indices);
        isBound = true;
      }
      renderPass.setVertexBuffer(0, mesh.stencil);
      renderPass.draw(mesh.vertexCount, 1, 0, slot);
      // The edges with their analytic coverage, then the cover inside them, then the
      // hulls' marks cleared.
      if (mesh.edges !== undefined) {
        renderPass.setPipeline(pipelines.edges);
        renderPass.setVertexBuffer(0, mesh.edges);
        renderPass.draw(mesh.edgeVertexCount, 1, 0, slot);
        context.frame.stats.drawCalls += 1;
      }
      renderPass.setPipeline(pipelines.cover);
      renderPass.setVertexBuffer(0, mesh.cover);
      renderPass.draw(6, 1, 0, slot);
      renderPass.setPipeline(pipelines.cleanup);
      renderPass.draw(6, 1, 0, slot);
      context.frame.stats.drawCalls += 3;
      context.frame.stats.vectorTextRuns += 1;
    }
  }

  /**
   * Nothing is built in the background: geometry lands through the text pass.
   *
   * @returns False.
   */
  hasPendingWork(): boolean {
    return false;
  }

  /**
   * The run meshes' GPU bytes.
   *
   * @returns The category (`meshes`) and bytes.
   */
  memory(): DrawerMemory {
    return { category: 'meshes', bytes: this.meshBytes };
  }

  /** Frees every mesh and the pipelines. */
  destroy(): void {
    for (const mesh of this.meshes.values()) this.release(mesh);
    this.meshes.clear();
    this.frameMeshes.clear();
    this.meshBytes = 0;
    destroyVectorTextPipelines(this.pipelines);
    if (this.move) destroyVectorTextPipelines(this.move.pipelines);
    this.move = undefined;
  }

  private createPipelines(placement: MovePlacementBinding | undefined): VectorTextPipelines {
    const { backend, cameraUniform, clipTable } = this.setup;
    const label = placement === undefined ? this.passName : `${this.passName} move`;
    return createVectorTextPipelines(
      backend,
      this.pass.layout,
      cameraUniform.buffer,
      clipTable,
      label,
      placement,
    );
  }

  /**
   * Finds this frame's on-screen runs drawn from their outlines and builds their meshes.
   *
   * @param context - The frame.
   */
  private prepare(context: FrameContext): void {
    this.frameMeshes.clear();
    const slotRevision = context.scene.slotOwnershipRevision;
    if (this.state.version !== this.runsVersion || slotRevision !== this.runsSlotRevision) {
      this.runsSlotRevision = slotRevision;
      this.collectRuns(context);
    }
    // A face added or replaced: every mesh holds the old outlines.
    if (this.state.generation !== this.meshGeneration) {
      this.meshGeneration = this.state.generation;
      this.trim(0);
    }
    if (this.runsBySlot.size === 0) {
      this.trim(0);
      return;
    }
    for (const { passName, ranges } of context.drawList) {
      if (passName !== this.passName) continue;
      for (const { start, count } of ranges) {
        if (count <= this.runsBySlot.size) {
          for (let slot = start; slot < start + count; slot += 1) this.prepareSlot(slot, context);
        } else {
          for (const slot of this.runsBySlot.keys()) {
            if (slot >= start && slot < start + count) this.prepareSlot(slot, context);
          }
        }
      }
    }
    this.trim(this.meshBudgetBytes);
  }

  private collectRuns(context: FrameContext): void {
    this.runsVersion = this.state.version;
    this.runsBySlot.clear();
    for (const [id, text] of this.state.drawn) {
      const slots = context.scene.slotsOf(id, this.passName);
      for (const run of text.runs) {
        const slot = slots[run];
        if (slot !== undefined) this.runsBySlot.set(slot, { id, run, text });
      }
    }
  }

  private prepareSlot(slot: number, context: FrameContext): void {
    const drawn = this.runsBySlot.get(slot);
    if (drawn === undefined) return;
    const mesh = this.meshOf(drawn, context);
    if (mesh !== undefined) this.frameMeshes.set(slot, mesh);
  }

  /**
   * A run's mesh: the cached one while its layout and box are the same, else built now.
   *
   * @param drawn - The run.
   * @param context - The frame, whose statistics count uploads.
   * @returns The mesh; `undefined` for a run with nothing to draw, or whose geometry was evicted
   *   (the text pass then draws it from the atlas again until the geometry lands).
   */
  private meshOf(drawn: DrawnRun, context: FrameContext): RunMesh | undefined {
    const { id, run, text } = drawn;
    const { layout } = text;
    const key = `${id}#${String(run)}`;
    const origin = textOriginOf(text.entry.geometry, layout);
    const cached = this.meshes.get(key);
    if (cached !== undefined) {
      this.meshes.delete(key);
      if (cached.layout === layout && cached.originX === origin.x && cached.originY === origin.y) {
        this.meshes.set(key, cached);
        return cached;
      }
      this.release(cached);
    }
    const placement = { originX: origin.x, originY: origin.y };
    const built = buildVectorRunMesh(layout, run, placement, (face, glyph) =>
      this.state.lookup(face, glyph),
    );
    if (built.mesh === undefined) {
      this.state.invalidate(id);
      return undefined;
    }
    const { vertices, vertexCount, bounds, edges: edgeVertices, edgeVertexCount } = built.mesh;
    if (bounds === undefined) return undefined;
    const stencil = this.upload(`${this.passName} run`, vertices);
    const reach = (layout.runs[run]?.fontSize ?? 0) * COVER_REACH_EM;
    const grown = {
      minX: bounds.minX - reach,
      minY: bounds.minY - reach,
      maxX: bounds.maxX + reach,
      maxY: bounds.maxY + reach,
    };
    const cover = this.upload(`${this.passName} cover`, vectorCoverQuad(grown));
    const edges =
      edgeVertexCount > 0 ? this.upload(`${this.passName} edges`, edgeVertices) : undefined;
    const bytes = vertices.byteLength + COVER_BYTES + (edges ? edgeVertices.byteLength : 0);
    context.stats.bufferWrites += edges ? 3 : 2;
    context.stats.uploadedBytes += bytes;
    const mesh = {
      layout,
      originX: origin.x,
      originY: origin.y,
      stencil,
      vertexCount,
      cover,
      edges,
      edgeVertexCount,
      bytes,
    };
    this.meshes.set(key, mesh);
    this.meshBytes += bytes;
    return mesh;
  }

  private upload(label: string, data: Float32Array): GpuBuffer {
    const buffer = this.backend.createBuffer({
      usage: 'vertex',
      byteLength: data.byteLength,
      label,
    });
    this.backend.writeBuffer(buffer, 0, data as Float32Array<ArrayBuffer>);
    return buffer;
  }

  /**
   * Frees the least recently drawn meshes not on screen until those left fit the budget.
   *
   * @param budget - The bytes to keep at most, beside this frame's.
   */
  private trim(budget: number): void {
    const onScreen = new Set(this.frameMeshes.values());
    for (const [key, mesh] of this.meshes) {
      if (this.meshBytes <= budget) return;
      if (onScreen.has(mesh)) continue;
      this.meshes.delete(key);
      this.release(mesh);
    }
  }

  private release(mesh: RunMesh): void {
    mesh.stencil.destroy();
    mesh.cover.destroy();
    mesh.edges?.destroy();
    this.meshBytes -= mesh.bytes;
  }
}
