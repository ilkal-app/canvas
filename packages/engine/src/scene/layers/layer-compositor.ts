import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuViewport } from '../../gpu/gpu-render-pass.js';
import { isRenderTargetBottomUp, type GpuRenderTarget } from '../../gpu/gpu-render-target.js';
import {
  LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH,
  layerCompositePlacement,
  layerCompositeResources,
  layerCompositeUniform,
  recordLayerComposite,
} from '../../gpu/layer-composite-pass.js';
import type { DrawListEntry } from '../draw-list.js';
import type { FrameContext } from '../frame-context.js';
import type { InstanceBuffer } from '../instance-buffer.js';
import type {
  DrawerMemory,
  EntryDrawContext,
  ScenePassDrawer,
  ScenePassDrawerSetup,
} from '../scene-pass-drawer.js';

import {
  DEFAULT_LAYER_BYTE_BUDGET,
  LAYER_LIMIT,
  layerScratchBytes,
  layerScratchBytesPerTexel,
  layerTileEdge,
  layerTiles,
} from './layer-budget.js';
import { LayerCompositeDraws, type CompositeDestination } from './layer-composite-draws.js';
import { canvasDeviceRect, layerCamera, layerDeviceRect } from './layer-rect.js';
import { LayerSelection } from './layer-selection.js';
import { LayerTargetPool } from './layer-target-pool.js';

/** One tile of a layer: a pass of its window into a target, composited on its own. */
export interface LayerTile {
  /** The target its window draws into. */
  readonly target: GpuRenderTarget;
  /** The camera its window draws with (`layerCamera`). */
  readonly camera: Camera;
  /** Its rectangle in canvas device pixels. */
  readonly rect: GpuViewport;
}

/** What a layer draws with this frame: its tiles and where it lands. */
export interface LayerFrameState {
  /** The layer. */
  readonly id: ObjectId;
  /** Its rectangle in canvas device pixels: the union of its tiles. */
  readonly rect: GpuViewport;
  /** Its tiles, left to right, then top to bottom; one when it fits a tile. */
  readonly tiles: readonly LayerTile[];
}

/** How a layer composite pass's drawer bounds its layers. */
export interface LayerCompositorOptions {
  /** The layers share of the device's budget, bytes; default the desktop's 48 MiB. */
  readonly byteBudget?: number;
  /** The most layers composited per frame; default 16. */
  readonly limit?: number;
}

/** A prepared layer as its children see it: where they must stay and where they composite. */
interface Placed {
  readonly rect: GpuViewport;
  readonly into: readonly CompositeDestination[];
}

/** The destination key of the canvas pass. */
const CANVAS = 'canvas';

/**
 * The key of a layer tile as a destination and a target owner.
 *
 * @param id - The layer.
 * @param index - The tile's index.
 * @returns The key.
 */
function tileKey(id: ObjectId, index: number): string {
  return `${id}#${String(index)}`;
}

/**
 * Whether two rectangles share any pixel.
 *
 * @param a - One rectangle.
 * @param b - Another.
 * @returns True when they overlap.
 */
function overlaps(a: GpuViewport, b: GpuViewport): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The layer composite pass's drawer (C2c). Before any pass opens, `prepare` works
 * out each planned layer's rectangle (outermost first, each inside its parent's), cuts one wider
 * or taller than a tile (`layerTileEdge`: 1024 px on a desktop) into tiles along the canvas's
 * tile grid, gives each tile a pooled target (`LayerTargetPool`: 64 px buckets, freed after two
 * seconds idle) and a translated camera, and writes one composite uniform per tile and
 * destination: the canvas, or each tile of the parent layer the tile overlaps. The `layers`
 * stage renders each tile's window (`enterTile` names the destination its child composites
 * draw into) and `drawEntry` records the composites of the open destination. Which layers
 * composite is its `selection`'s (`LayerSelection`); the z-order segments ask it each frame.
 * A layer that fell back for the budget (`LayerDraw.isInline`) gets no target: `drawEntry` draws
 * its window where its composite would have drawn, and its child layers composite there. A
 * composite's opacity is its layer's, times its ancestors' drawn in the multiply form between it
 * and the nearest layer that composites (`Scene.layerOpacity`). Charged under `layers`: the
 * targets' resolved colour, the uniforms and, while any target lives, the backend's shared
 * scratch as it allocates it: the live targets' extent at the backend's bytes per texel
 * (`layerScratchBytes`, `layerScratchBytesPerTexel`). Runs on the
 * rendering thread; allocates nothing until a frame draws a layer.
 */
export class LayerCompositor implements ScenePassDrawer {
  /** Which layers composite each frame and which fall back to the multiply form. */
  readonly selection: LayerSelection;
  private readonly backend: GpuBackend;
  private readonly instances: InstanceBuffer;
  private readonly tile: number;
  private readonly byteBudget: number;
  /** The backend's scratch bytes per texel. */
  private readonly scratchRate: number;
  private readonly targets: LayerTargetPool;
  private readonly draws: LayerCompositeDraws;
  private readonly states = new Map<ObjectId, LayerFrameState>();
  /**
   * Each prepared layer's rectangle and where its children composite: its tiles, or an inline
   * layer's own places.
   */
  private readonly placed = new Map<ObjectId, Placed>();
  /** The inline layers' composite slots: their windows draw there instead. */
  private readonly inlineBySlot = new Map<number, ObjectId>();
  private destination = CANVAS;
  /** The composite uniform each draw is written into before the draws copy it. */
  private readonly uniform = new Float32Array(LAYER_COMPOSITE_UNIFORM_BYTE_LENGTH / 4);

  /**
   * Creates the drawer; nothing is allocated until a frame draws a layer.
   *
   * @param setup - The backend and the pass's instance buffer, whose records hold each layer's
   *   opacity.
   * @param options - The layers budget and limit.
   */
  constructor(setup: ScenePassDrawerSetup, options: LayerCompositorOptions = {}) {
    this.backend = setup.backend;
    this.instances = setup.instances;
    this.byteBudget = options.byteBudget ?? DEFAULT_LAYER_BYTE_BUDGET;
    this.tile = layerTileEdge(this.byteBudget, this.backend.capabilities.maxTextureSize);
    this.targets = new LayerTargetPool(this.backend, this.tile);
    this.scratchRate = layerScratchBytesPerTexel(this.backend.capabilities);
    const { targets } = this;
    this.selection = new LayerSelection({
      byteBudget: this.byteBudget,
      tile: this.tile,
      limit: options.limit ?? LAYER_LIMIT,
      scratchBytesPerTexel: this.scratchRate,
      heldBytes: () => targets.heldBytesByLayer(),
      heldExtent: () => targets.heldExtentByLayer(),
    });
    this.draws = new LayerCompositeDraws(this.backend);
  }

  /** The renderer installs the `layers` stage itself, after every drawer's stages. */
  install(): void {
    // Nothing: see `createLayersStage`.
  }

  /**
   * A composite draws at the layer's rectangle, worked out each frame from the moved objects'
   * boxes, so retained move placements change nothing here.
   */
  setMovePlacement(): void {
    // Nothing to select.
  }

  /**
   * Works out the frame's layers before any pass opens: rectangles, tiles, targets, cameras and
   * composite uniforms; then frees targets and uniforms idle for two seconds, and counts the
   * layers drawn and the bytes held in the frame's statistics. A layer whose rectangle is empty
   * (offscreen, or outside its parent's) gets no state: its window and composite are skipped.
   *
   * @param context - The frame, with its layers.
   */
  prepare(context: FrameContext): void {
    this.states.clear();
    this.placed.clear();
    this.inlineBySlot.clear();
    this.draws.begin();
    this.destination = CANVAS;
    const { camera, frameIndex, layers, timeMs, scene } = context;
    const canvas = canvasDeviceRect(camera);
    const onCanvas = [{ key: CANVAS, rect: canvas, size: canvas }];
    const isBottomUp = isRenderTargetBottomUp(this.backend.capabilities.backendName);
    let drawn = 0;
    // Outermost first: a parent's rectangle bounds its children's.
    for (let at = layers.length - 1; at >= 0; at -= 1) {
      const layer = layers[at];
      if (layer === undefined) continue;
      const parent =
        layer.parent === undefined
          ? { rect: canvas, into: onCanvas }
          : this.placed.get(layer.parent);
      if (parent === undefined) continue; // Under a parent that draws nothing.
      const rect = layerDeviceRect(layer.bounds, camera, parent.rect);
      if (rect === undefined) continue;
      const destinations = parent.into;
      if (layer.isInline === true) {
        // Drawn in place of its composite: its children composite where it draws.
        this.states.set(layer.id, { id: layer.id, rect, tiles: [] });
        this.placed.set(layer.id, { rect, into: destinations });
        this.inlineBySlot.set(layer.slot, layer.id);
        continue;
      }
      const keys = layerTiles(rect, this.tile).map((part, index) => ({
        part,
        key: tileKey(layer.id, index),
      }));
      const tiles = keys.map(({ part, key }): LayerTile => {
        const target = this.targets.acquire(key, part, frameIndex, timeMs);
        return { target, camera: layerCamera(camera, part, target), rect: part };
      });
      this.states.set(layer.id, { id: layer.id, rect, tiles });
      this.placed.set(layer.id, {
        rect,
        into: tiles.map(({ rect: into, target }, index) => ({
          key: keys[index]?.key ?? tileKey(layer.id, index),
          rect: into,
          size: target,
        })),
      });
      drawn += 1;
      // Its own opacity, times any ancestors' drawn in the multiply form above it.
      const opacity = this.opacityOf(layer.slot) * scene.layerOpacity.multiplierOf(layer.id);
      for (const tile of tiles) {
        for (const into of destinations) {
          if (!overlaps(tile.rect, into.rect)) continue;
          const placement = layerCompositePlacement(
            { ...tile.rect, x: tile.rect.x - into.rect.x, y: tile.rect.y - into.rect.y },
            into.size,
            tile.target,
          );
          const uniform = layerCompositeUniform(opacity, isBottomUp, placement, this.uniform);
          this.draws.add(into.key, layer.slot, tile.target, uniform, context);
        }
      }
    }
    this.draws.releaseIdle(timeMs);
    // Strictly under the budget, with the scratch and the uniforms counted.
    const room = this.byteBudget - this.scratchBytes() - this.draws.byteLength - 1;
    this.targets.releaseIdle(frameIndex, timeMs, room);
    context.stats.layersDrawn = drawn;
    context.stats.layerBytes = this.memory().bytes;
  }

  /**
   * Whether any target or uniform is still pooled: a frame without layers then still prepares,
   * so idle ones are freed in time.
   *
   * @returns True while the pool holds one.
   */
  get hasPooledLayers(): boolean {
    return this.targets.size > 0 || this.draws.size > 0;
  }

  /**
   * A layer's state this frame, from `prepare`.
   *
   * @param id - The layer.
   * @returns Its tiles and rectangle, or undefined when it draws nothing this frame.
   */
  stateOf(id: ObjectId): LayerFrameState | undefined {
    return this.states.get(id);
  }

  /**
   * Names the pass about to open: a layer's tile, whose child composites `drawEntry` records
   * next.
   *
   * @param id - The layer.
   * @param index - The tile's index.
   */
  enterTile(id: ObjectId, index: number): void {
    this.destination = tileKey(id, index);
  }

  /** Names the canvas pass as the next one: outermost composites draw there. */
  enterCanvas(): void {
    this.destination = CANVAS;
  }

  /**
   * Records the composites into the open pass of every prepared layer among the entry's
   * records: each of its tiles that overlaps the pass; an inline layer's window instead.
   *
   * @param context - The open pass and the frame.
   * @param entry - Composite records: the layers that draw into this pass.
   */
  drawEntry(context: EntryDrawContext, entry: DrawListEntry): void {
    const draws = this.draws.into(this.destination);
    for (const { start, count } of entry.ranges) {
      for (let slot = start; slot < start + count; slot += 1) {
        const inline = this.inlineBySlot.get(slot);
        if (inline !== undefined) this.drawInline(context, inline);
        for (const bindGroup of draws?.get(slot) ?? []) {
          // Made by `prepare`, before any pass opened.
          const resources = layerCompositeResources(this.backend);
          recordLayerComposite(context.renderPass, resources, bindGroup, slot);
          context.frame.stats.drawCalls += 1;
        }
      }
    }
  }

  /**
   * Draws an inline layer's window into the open pass, where its composite would have drawn:
   * its records carry its opacity (the multiply form), and its child layers' composites draw
   * here too.
   *
   * @param context - The open pass and the frame.
   * @param layer - The inline layer.
   */
  private drawInline(context: EntryDrawContext, layer: ObjectId): void {
    const { frame, renderPass } = context;
    for (const entry of frame.drawList) {
      if (entry.layer !== layer) continue;
      frame.passes
        .find(({ pass }) => pass.name === entry.passName)
        ?.drawEntry(renderPass, entry, frame);
    }
  }

  /**
   * Nothing is ever pending: a layer is complete in the frame that draws it.
   *
   * @returns False.
   */
  hasPendingWork(): boolean {
    return false;
  }

  /**
   * What the layers hold, under `layers`: the targets' resolved colour, the composite uniforms
   * and, while any target lives, the shared scratch at the targets' extent.
   *
   * @returns The category and bytes.
   */
  memory(): DrawerMemory {
    return {
      category: 'layers',
      bytes: this.targets.byteLength + this.draws.byteLength + this.scratchBytes(),
    };
  }

  /** Frees every pooled target and uniform. */
  destroy(): void {
    this.targets.destroyAll();
    this.draws.destroyAll();
    this.states.clear();
  }

  /**
   * The scratch's charge: as the backend allocates it while any target lives (the targets'
   * widest width by their tallest height, at its bytes per texel), else nothing.
   *
   * @returns The bytes.
   */
  private scratchBytes(): number {
    return this.targets.size > 0 ? layerScratchBytes(this.targets.extent, this.scratchRate) : 0;
  }

  /**
   * A layer's opacity: its composite record's first float (`LAYER_COMPOSITE_PASS.prepare`).
   *
   * @param slot - The record's slot.
   * @returns The opacity, in [0, 1].
   */
  private opacityOf(slot: number): number {
    const value = this.instances.data[slot * this.instances.layout.floatsPerRecord] ?? 1;
    return Math.min(1, Math.max(0, value));
  }
}
