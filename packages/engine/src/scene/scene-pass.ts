import type { BoardObject, ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { GpuBindingLayoutEntry, GpuBlendMode } from '../gpu/gpu-pipeline.js';
import type { GpuShaderSource } from '../gpu/gpu-shader.js';
import type { GpuVertexBufferLayout } from '../gpu/vertex-layout.js';
import type { ImagePassSupport } from '../images/image-pass-support.js';
import type { LevelOfDetail, PassLevelOfDetail } from '../lod/level-of-detail.js';
import type { AtlasLoan } from '../memory/atlas-loan.js';
import type { DeviceMemoryBudget } from '../memory/device-budget.js';
import type { ColorPalette } from '../paint/color-palette.js';
import type { TextPassResources } from '../text/scene/text-pass-resources.js';

import type { Frame } from './frame.js';
import type { InstanceLayout } from './instance-layout.js';
import type { ScenePassDrawer, ScenePassDrawerSetup } from './scene-pass-drawer.js';
import type { WorldTransform } from './world-transform.js';

/**
 * What a scene pass's pipeline is built from. Every scene pass shares one binding contract: WGSL
 * `@group(0) @binding(0)` is the camera uniform, `struct { scale: vec2f, offset: vec2f }` with
 * `clip = world × scale + offset`, followed by `pixel: f32`, one device pixel in world units, for
 * a pass that pads its quads for antialiasing (32 bytes in all, `CameraUniform`; a pass may
 * declare the first 16 only); vertex buffer slot 0 is the per-vertex geometry below and
 * slot 1 the pass's persistent instance buffer. Frame clipping: `@binding(5)` is the
 * scene's clip table (a load-only rgba32float texture, `ClipTableTexture`, bound by the renderer
 * in every scene pass's group, page bindings included), and a layout from
 * `resolveSceneInstanceLayout` ends with the record's clip index at `@location(14)`; a scene
 * shader passes both to `clipVertex` and multiplies its premultiplied output by `clipCoverage`
 * (`scripts/clip-shader.ts`), never discarding. Bindings 1 to 4 are the pass's. A custom-draw pass (`createDrawer`) builds its
 * own pipelines from `shader`, `vertexLayout` and `blend`, and its `vertices` go unused.
 */
export interface ScenePipelineSpec {
  /** The pass's shaders (a generated `*.generated.ts` module under `src/gpu/shaders/`). */
  readonly shader: GpuShaderSource;
  /** Optional absolute-placement variant; index zero retains ordinary instance placement. */
  readonly moveShader?: GpuShaderSource;
  /** The per-vertex layout of slot 0 (`stepMode: 'vertex'`). */
  readonly vertexLayout: GpuVertexBufferLayout;
  /** The per-vertex data, uploaded once when the pass's GPU resources are created. */
  readonly vertices: Float32Array<ArrayBuffer>;
  /** Vertices per instance: a multiple of 3 (triangle lists). */
  readonly vertexCount: number;
  /** How the pass blends; scene passes output premultiplied colour. */
  readonly blend: GpuBlendMode;
  /**
   * The bindings each page of a paged pass adds after the camera at binding 0 (draw calls are
   * bounded by passes times atlas pages times opaque segments): the page's
   * texture, its sampler and any per-page uniform. A pass that samples an atlas or a texture
   * declares them here, names each record's page with {@link ScenePass.pageOf} and supplies each
   * page's resources with {@link ScenePass.pageEntries}; the frame then draws its records one
   * page at a time, each page with its own bind group. Absent, the pass binds the camera alone.
   */
  readonly pageBindings?: readonly GpuBindingLayoutEntry[];
  /**
   * Shaders for a page whose records name only its first `pageSlots` resources,
   * fewest slots first, each with `shader`'s bindings: the frame draws such a page with the first
   * variant whose `pageSlots` covers {@link ScenePass.pageSlotsOf}, `shader` otherwise. For a
   * shader that picks a texture per record, where every texture its switch can reach costs
   * fragment time, whichever one the records pick.
   */
  readonly pageShaderVariants?: readonly {
    /** The leading page resources the variant's shader can reach. */
    readonly pageSlots: number;
    /** The variant's shaders, with `shader`'s bindings. */
    readonly shader: GpuShaderSource;
  }[];
  /**
   * Whether the pipeline waits for the pass's first record: built on the first upload
   * that finds one, not when the scene starts, so a pass most boards never use (a rounded
   * frame's) costs nothing at engine start. Absent, it is built with the pass's resources.
   */
  readonly isDeferred?: boolean;
}

/** An object as a pass sees it: its document fields plus its resolved world transform. */
export interface SceneObject {
  /** The object as the document holds it. */
  readonly object: BoardObject;
  /** Its own frame to the world, ancestors included. */
  readonly transform: WorldTransform;
  /**
   * What `'ink'` and colour token references draw as for this object:
   * the board's tokens in the object's colour mode, which the scene sets from the nearest frame,
   * main or instance with a `colorMode`, else the viewer's theme (`SceneRenderer.setTheme`).
   * Absent: the light theme's built-ins (`LIGHT_PALETTE`).
   */
  readonly palette?: ColorPalette;
  /**
   * What `'ink'` and tokens in its text draw as, when that differs from `palette`: a
   * sticky's or filled shape's text reads against its own fill (`containerTextMode`). Absent:
   * `palette`.
   */
  readonly textPalette?: ColorPalette;
}

/**
 * One render pass of the scene: which
 * objects it draws, how many instance records each needs and how to fill them. The scene gives
 * each pass one persistent `InstanceBuffer` with this pass's {@link InstanceLayout} and
 * calls `prepare` only when an object changes; the frame draws the buffer's visible ranges with
 * one pipeline built from {@link ScenePass.pipelineSpec}.
 *
 * A pass is registered by listing it in `SceneRendererOptions.passes`; by default passes draw
 * in list order within each z-order segment (the frame's draw list decides). `recordCount` and
 * `isOccluder` must be pure functions of the object (the z-order segments compare them across
 * a change); `prepare` and `pageOf` may also read state the pass keeps (a layout cache), and a
 * pass whose state changes rewrites the affected records itself (`install`,
 * `Scene.rewriteRecords`).
 *
 * A pass's `layout` from `resolveSceneInstanceLayout` (every built-in pass's) ends with the clip
 * index the scene writes after `prepare`, so `prepare` fills only the pass's own floats.
 *
 * An all-zero record must draw nothing: released slots are zeroed and stay inside the drawn
 * range `[0, recordCount)`, so the pass's shader must turn zeros into no coverage (the
 * solid-rect pass's zero size collapses its quad).
 */
export interface ScenePass {
  /** Proves recordCount and isOccluder are unchanged by root x/y-only moves; default false. */
  readonly isRootMoveOrderStable?: boolean;
  /** A unique name; also the key of the pass's instance buffer and its draw list entries. */
  readonly name: string;
  /** The per-instance record layout (slot 1). */
  readonly layout: InstanceLayout;
  /** Shaders, per-vertex geometry and blending. */
  readonly pipelineSpec: ScenePipelineSpec;
  /**
   * How many instance records an object needs in this pass: 0 when the pass does not draw it.
   *
   * @param object - The object.
   * @returns The record count.
   */
  recordCount(object: BoardObject): number;
  /**
   * Whether this pass paints the object over what lies below it in z-order, whatever pass drew
   * that: an "occluder" in the sense of the z-order segments, not necessarily opaque. A flagged
   * object starts a split, which becomes a new segment where its box
   * meets content of the segment below that a later pass draws, so it lands over that content
   * instead of under it (the passes draw in registered order within a segment). Flag every
   * object the pass paints that can sit over a later pass's content, whatever its alpha: a sticky
   * note, a frame background, a shape with a translucent fill or only an outline, an image at
   * any opacity above 0. An object that is not flagged shares a split with the objects below it
   * and draws in pass order among them, which is right only when nothing below it draws in a
   * later pass (as for text, drawn by the last pass). Flag nothing the pass does not paint:
   * each flag can cost a segment, though the planner merges splits whose boxes meet nothing.
   * Omitted, the pass flags nothing. Must be a pure function of the object.
   *
   * @param object - The object.
   * @returns Whether it must be ordered over later-pass content below it.
   */
  isOccluder?(object: BoardObject): boolean;
  /**
   * Whether the pass's records of an object paint after the object's descendants rather than
   * with the object (a frame's outline, over its own children). The z-order segments
   * give each object this pass draws a second, closing paint rank, after its subtree and before
   * its next sibling, and order these records (and their `isOccluder` flag) there; the object's
   * other passes keep its own rank. Default false: every record paints at its object's rank.
   */
  readonly isDrawnAfterDescendants?: boolean;
  /**
   * Whether the pass's records always draw on the canvas, never inside an offscreen layer:
   * so they never fade with a layer's partial opacity. At opacity 0 they are hidden
   * with the rest of the object (). Frame names are drawn so
   * (`FRAME_TITLE_PASS`). Default false.
   */
  readonly isOutsideLayers?: boolean;
  /**
   * The pass's level-of-detail rule: the rule's thresholds and the size, world units, it
   * measures on each object the pass draws. The scene keeps every such object's form
   * (`Scene.levelOfDetail`), with a hysteresis band per object, and updates the visible ones each
   * frame; the pass draws each object in its form (`LevelOfDetail.formOf`, rewriting those in
   * `changedIn`), and the z-order segments leave out records of objects in the `hidden` form, so
   * they neither draw nor split segments. Omitted, the pass draws everything in full.
   */
  readonly levelOfDetail?: PassLevelOfDetail;
  /**
   * Fills one of an object's records. `record` arrives zero-filled; unchanged records are not
   * re-uploaded.
   *
   * @param record - The record to fill, `layout.floatsPerRecord` floats.
   * @param target - The object and its world transform.
   * @param recordIndex - Which of the object's records, from 0 to `recordCount − 1`.
   */
  prepare(record: Float32Array, target: SceneObject, recordIndex: number): void;
  /** Optional exact per-record placement, when the record origin differs from its object. */
  movePlacement?(target: SceneObject, recordIndex: number): WorldTransform;
  /** Proves this pass never draws root leaves, at any position (for example frame backgrounds). */
  readonly isRootMoveEmpty?: boolean;
  /** Refreshes pass-owned targets during a geometry-preserving root move. */
  retainMoveTarget?(target: SceneObject): void;
  /**
   * Whether `retainMoveTarget` must also see each target while a retained move only translates
   * its members: true for a pass that keeps world placement of its own which the
   * culler's moving boxes do not carry, as image residency does. Others are given the targets
   * once, when the translation settles.
   */
  readonly shouldFollowTranslatedTargets?: boolean;
  /**
   * Optionally updates retained per-object state and proves that full preparation would change
   * only one shared slice of its first `recordCount` records. Called only when slot counts are
   * unchanged. All other floats, remaining records and page assignments must remain identical
   * to full preparation. Undefined requests normal preparation; borrowed values are consumed
   * before another pass call. For example, text with unchanged glyph quads patches its origin.
   *
   * @param target - The new object and transform.
   * @returns A proven partial update, or undefined for full preparation.
   */
  preparePatch?(target: SceneObject):
    | {
        /** Number of instance records retained by this patch. */
        readonly recordCount: number;
        /** First float within each retained instance record to replace. */
        readonly firstFloat: number;
        /** Replacement floats, borrowed until the next pass call. */
        readonly values: Float32Array;
      }
    | undefined;
  /**
   * Makes the pass a custom-draw pass: the renderer creates one drawer per renderer
   * and hands it each of this pass's draw-list entries to draw (`ScenePassDrawer.drawEntry`)
   * instead of one instanced draw of the pipeline spec per range. For passes that are not one
   * instanced quad per record, such as the path pass's stencil-then-cover fills and stroke
   * meshes. The records are still the scene's (`prepare`), culled and z-ordered as any pass's.
   * Omitted, the pass draws its instanced quads.
   *
   * @param setup - The backend, the pass's instance buffer and the camera uniform.
   * @returns The drawer, owned by the renderer from now on.
   */
  createDrawer?(setup: ScenePassDrawerSetup): ScenePassDrawer;
  /**
   * The page one of an object's records samples (a paged pass: {@link ScenePipelineSpec.pageBindings}):
   * an atlas page or a texture, a small non-negative integer the pass chooses. The scene asks
   * right after `prepare` for the same record and keeps the answer per slot, so the page must
   * follow from the record just written; the `cull` stage and the z-order segments split each
   * pass's draw list entries by page. Omitted, every record is on page 0.
   *
   * @param target - The object and its world transform.
   * @param recordIndex - Which of the object's records.
   * @returns The page.
   */
  pageOf?(target: SceneObject, recordIndex: number): number;
  /**
   * The resources one page binds at {@link ScenePipelineSpec.pageBindings}, one entry per
   * binding there. Asked when a page is first drawn and again whenever the entries it returns
   * name other resources (a page texture recreated), so return the same objects while they stay
   * valid. Required of a paged pass.
   *
   * @param page - A page some drawn record is on.
   * @returns The page's entries.
   */
  pageEntries?(page: number): readonly GpuBindGroupEntry[];
  /**
   * How many of a page's leading resources its records may name: the frame draws
   * the page with the {@link ScenePipelineSpec.pageShaderVariants} entry that covers it. Asked
   * each time the page is drawn. Omitted, every page draws with the pass's `shader`.
   *
   * @param page - A page some drawn record is on.
   * @returns The leading resources, at least 1.
   */
  pageSlotsOf?(page: number): number;
  /**
   * Whether a paged pass's records keep paint order across pages. A z-order segment draws a
   * paged pass page by page, which puts a later record on a lower page under an earlier one on a
   * higher page: harmless for glyphs, which seldom overlap across objects, wrong for images,
   * which often do. When true, an object whose pages come before a page already used in
   * its segment starts a new segment. Default false.
   */
  readonly isPaintOrderedAcrossPages?: boolean;
  /**
   * Adds the pass's own frame stages: a pass that keeps state beyond its records (a layout
   * cache, an atlas, textures) brings it up to date here, before the scene's records are
   * uploaded, and rewrites records whose inputs changed without a document change
   * (`Scene.rewriteRecords`). Called once, when the renderer is built.
   *
   * @param frame - The renderer's frame.
   */
  install?(frame: Frame): void;
  /**
   * Told when an object no longer has records in this pass (deleted, or no longer drawn by
   * it), so a pass that caches per object can forget it.
   *
   * @param id - The object.
   */
  forget?(id: ObjectId): void;
  /**
   * Reports GPU memory the pass holds beyond its instance buffer (an atlas, textures) to the
   * frame statistics' ledger; called at the end of every recorded
   * frame, after the scene's own memory.
   *
   * @param ledger - The ledger.
   */
  reportMemory?(ledger: MemoryLedger): void;
  /** Frees what the pass created on the backend; called when the renderer is destroyed. */
  destroy?(): void;
}

/**
 * What a {@link ScenePassFactory} builds its pass with, on the thread that renders: the backend
 * and the host's hooks. Passes that keep state or GPU resources of their own (text: a layout
 * cache and a glyph atlas; images: a texture manager) are built per renderer from this, since
 * a pass cannot cross to the engine worker.
 */
export interface ScenePassEnvironment {
  /** Reports a shape label's actual world bounds to culling and paint-order planning. */
  readonly setTextBounds?: (id: ObjectId, bounds: WorldBounds | undefined) => void;
  /** The backend the renderer draws through. */
  readonly backend: GpuBackend;
  /**
   * Asks the renderer's owner for another frame: work the pass started has landed (a layout,
   * a glyph, a texture) and the frame should show it. Default: nothing (a caller that renders on
   * its own schedule, as tests do).
   */
  readonly requestFrame: () => void;
  /** The time now, ms, for work budgets; the scene itself reads no clock. Default always 0. */
  readonly now: () => number;
  /**
   * Fonts and the job pool the text pass lays text out and generates glyphs with; without
   * them the text pass draws nothing.
   */
  readonly text?: TextPassResources;
  /**
   * Where passes report the GPU memory they hold (GPU memory is accounted per
   * category); the host's, shared with its frame statistics. Absent: a pass keeps its own.
   */
  readonly ledger?: MemoryLedger;
  /**
   * The device's byte budget per memory category (`budgetForDevice`), which passes with caches
   * keep under. Absent: the desktop budget.
   */
  readonly budget?: DeviceMemoryBudget;
  /**
   * The textures' loan of unused memory to the scene text atlas, one per budget: the
   * text pass borrows through it and the image texture manager caps itself by it. Absent: no
   * lending, each at its own share.
   */
  readonly atlasLoan?: AtlasLoan;
  /**
   * The image pass's assets catalogue and decode pool. Absent: image objects draw their
   * placeholder colour.
   */
  readonly images?: ImagePassSupport;
  /**
   * The renderer's level-of-detail state, which its scene keeps: a pass with a rule
   * reads each object's form from it when it writes records. Absent: every object in full.
   */
  readonly levelOfDetail?: LevelOfDetail;
}

/**
 * Builds a pass for one renderer: the way a pass with state or GPU resources of its own is
 * listed in `SceneRendererOptions.passes` and in `createStandardScenePasses`.
 */
export interface ScenePassFactory {
  /** The name the built pass has. */
  readonly name: string;
  /**
   * Builds the pass.
   *
   * @param environment - The backend and the host's hooks.
   * @returns The pass, owned by the renderer (its `destroy` runs with the renderer's).
   */
  create(environment: ScenePassEnvironment): ScenePass;
}

/** A pass as a renderer is given it: a stateless pass value, or a factory building one per renderer. */
export type ScenePassEntry = ScenePass | ScenePassFactory;

/**
 * Builds a renderer's passes from its entries, in order: pass values as they are, factories
 * called with the environment.
 *
 * @param entries - The passes and factories.
 * @param environment - What factories build with.
 * @returns The passes.
 */
export function resolveScenePasses(
  entries: readonly ScenePassEntry[],
  environment: ScenePassEnvironment,
): ScenePass[] {
  return entries.map((entry) => ('create' in entry ? entry.create(environment) : entry));
}
