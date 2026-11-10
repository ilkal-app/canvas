import { paintAverageColor, paintBoxOf, type BoardObject, type Rgba } from '@canvas/schema';

import { CONNECTOR_LEVEL_OF_DETAIL } from '../connectors/connector-detail.js';
import { PATH_GRADIENT_MOVE_SHADER } from '../gpu/shaders/path-gradient-move.generated.js';
import { PATH_GRADIENT_SHADER } from '../gpu/shaders/path-gradient.generated.js';
import { PATH_MOVE_SHADER } from '../gpu/shaders/path-move.generated.js';
import { PATH_SHADER } from '../gpu/shaders/path.generated.js';
import { paletteOf, type ColorPalette } from '../paint/color-palette.js';
import { GradientRecords, PAINT_TABLE_BINDINGS } from '../paint/gradient-records.js';
import { drawnColor, readFill, readGradient } from '../paint/paint-reading.js';
import { resolveSceneInstanceLayout } from '../scene/instance-layout.js';
import type { SceneObject, ScenePass, ScenePassFactory } from '../scene/scene-pass.js';

import { PATH_LEVEL_OF_DETAIL } from './chord-mesh.js';
import { isDrawnPath, type DrawnPath } from './drawn-path.js';
import { PathDrawer, type PathDrawerOptions } from './path-drawer.js';
import type { PathFrameReport } from './path-frame-report.js';
import { pathLayersOf, type PathLayer } from './path-layers.js';
import type { PathMeshBuilder } from './path-mesh-builder.js';

/**
 * The mesh cache's default cap: 32 MiB, for a path pass built without a device budget. The
 * engine hosts pass the `meshes` share of `budgetForDevice` instead.
 */
export const DEFAULT_MESH_BYTE_BUDGET = 32 * 1024 * 1024;

/**
 * The connector pass's mesh cache cap in the standard passes, bytes: 8 MiB beside the path
 * pass's share. A connector's mesh is a few hundred vertices, so this holds tens of thousands of
 * them.
 */
export const CONNECTOR_MESH_BYTE_BUDGET = 8 * 1024 * 1024;

/**
 * Path segments a frame sends for meshing by default: about two hundred of the synthetic
 * board's six-vertex pen paths, a couple of milliseconds of inline meshing on a desktop
 * (`mesh-cache.bench.ts`), so a zoom across a bucket boundary over a board of paths spreads its
 * rebuild over frames while the previous bucket's meshes draw. Tunes it with the zoom
 * sweep.
 */
export const DEFAULT_MAX_MESH_SEGMENTS_PER_FRAME = 1024;

/** How {@link createPathPass} sets the pass up. */
export interface PathPassOptions {
  /** The pass's name. Default `path`, or `connector` for a connector pass. */
  readonly name?: string;
  /**
   * What the pass draws: `paths` (paths and lines, the default) or `connectors`, which
   * have a pass of their own so they take their own level-of-detail rule
   * (`CONNECTOR_LEVEL_OF_DETAIL`: hidden under half a device pixel of stroke).
   */
  readonly draws?: PathPassContent;
  /**
   * Builds meshes: the engine hosts pass `createPooledMeshBuilder` over their job pool;
   * `INLINE_MESH_BUILDER` (meshing on the rendering thread at once) is for tests, benchmarks
   * and golden scenes that need a frame's meshes in that frame.
   */
  readonly meshBuilder: PathMeshBuilder;
  /** The mesh cache's cap, bytes. Default {@link DEFAULT_MESH_BYTE_BUDGET}. */
  readonly meshByteBudget?: number;
  /**
   * The size of the vertex buffers meshes share, bytes; a mesh larger than a page gets
   * a buffer of its own, so 0 gives every mesh one. Default `PATH_MESH_PAGE_BYTES`, 1 MiB.
   */
  readonly meshPageBytes?: number;
  /**
   * Path segments a frame may send for meshing. Default
   * {@link DEFAULT_MAX_MESH_SEGMENTS_PER_FRAME}; `Infinity` meshes everything visible at once.
   */
  readonly maxMeshSegmentsPerFrame?: number;
  /** Called after every frame's mesh preparation, for tests and diagnostics. */
  readonly onFrame?: (report: PathFrameReport) => void;
  /** Receives mesh builds that failed or timed out; each is then made inline once. */
  readonly onFault?: (error: Error) => void;
  /** Frames before an unanswered build times out. Default `MESH_BUILD_TIMEOUT_FRAMES`. */
  readonly buildTimeoutFrames?: number;
  /**
   * Whether runs of consecutive opaque strokes draw batched, one draw each; fills and
   * translucent strokes keep their per-path draws. Not for the gradient variant. Default false.
   */
  readonly isBatched?: boolean;
}

/** What a path pass draws: paths and lines, or connectors. */
export type PathPassContent = 'paths' | 'connectors';

const NO_LAYERS: readonly PathLayer[] = [];

/**
 * The layers a pass draws of an object: its `pathLayersOf` when it is the pass's kind, paths
 * whose fill is a gradient going to the gradient variant and only there.
 *
 * @param draws - What the pass draws.
 * @param isGradient - Whether the pass is the gradient variant.
 * @returns The function.
 */
function layersFor(
  draws: PathPassContent,
  isGradient: boolean,
): (object: BoardObject) => readonly PathLayer[] {
  return (object) => {
    if ((object.type === 'connector') !== (draws === 'connectors')) return NO_LAYERS;
    const hasGradient = object.type === 'path' && readGradient(object.fill) !== undefined;
    return hasGradient === isGradient ? pathLayersOf(object) : NO_LAYERS;
  };
}

/** The unused per-vertex data of the spec: the pass draws each path's own mesh at slot 0. */
const NO_VERTICES = new Float32Array(0);

/** The solid path record: placement (location 1) and colour (location 2). */
const PATH_RECORD_ATTRIBUTES = [
  { location: 1, format: 'float32x4' },
  { location: 2, format: 'float32x4' },
] as const;

/** Floats of the solid path record, after which the gradient variant keeps its paint record. */
const PATH_RECORD_FLOATS = 8;

/**
 * The colour a path layer draws a solid record with: a stroke's resolved colour (`'ink'` as the
 * viewer's ink) or a solid fill; undefined for a gradient fill (the gradient variant's) or none.
 *
 * @param object - The path, line or connector.
 * @param layer - The layer.
 * @param palette - What ink and tokens draw as.
 * @returns The colour, or undefined.
 */
function layerColorOf(
  object: DrawnPath,
  layer: PathLayer | undefined,
  palette: ColorPalette,
): Rgba | undefined {
  if (object.type !== 'path' || layer === 'stroke') {
    return object.stroke ? drawnColor(object.stroke.color, palette) : undefined;
  }
  const fill = readFill(object.fill, palette);
  return Array.isArray(fill) ? fill : undefined;
}

/**
 * Writes a gradient fill layer's paint into its record (the gradient variant, `path-gradient`):
 * the path's paint box in its own frame (min x, min y, 1 / width, 1 / height; 0 for an axis of
 * zero extent, which maps to 0.5) where a stroke has its colour, and the paint table record; or,
 * in the chord form, the paint's average colour with record 0.
 *
 * @param record - The record, its placement written.
 * @param target - The path.
 * @param records - The pass's paint records.
 */
function writeGradientFill(
  record: Float32Array,
  target: SceneObject,
  records: GradientRecords,
): void {
  const { object } = target;
  const gradient = object.type === 'path' ? readGradient(object.fill) : undefined;
  if (object.type !== 'path' || gradient === undefined) return;
  const row = records.rowOf(target, gradient);
  record[PATH_RECORD_FLOATS] = row;
  if (row === 0) {
    record.set(paintAverageColor(gradient), 4);
    return;
  }
  const box = paintBoxOf(object);
  record[4] = box.x;
  record[5] = box.y;
  record[6] = box.width > 0 ? 1 / box.width : 0;
  record[7] = box.height > 0 ? 1 / box.height : 0;
}

/**
 * Builds a path pass, solid or the gradient variant.
 *
 * @param options - The pass's options.
 * @param records - The gradient variant's paint records; absent for a solid pass.
 * @returns The pass.
 */
function buildPathPass(options: PathPassOptions, records?: GradientRecords): ScenePass {
  const draws = options.draws ?? 'paths';
  const layersOf = layersFor(draws, records !== undefined);
  const drawerOptions: PathDrawerOptions = {
    layersOf,
    meshBuilder: options.meshBuilder,
    meshByteBudget: options.meshByteBudget ?? DEFAULT_MESH_BYTE_BUDGET,
    maxMeshSegmentsPerFrame: options.maxMeshSegmentsPerFrame ?? DEFAULT_MAX_MESH_SEGMENTS_PER_FRAME,
    ...(options.onFrame ? { onFrame: options.onFrame } : {}),
    ...(options.onFault ? { onFault: options.onFault } : {}),
    ...(options.buildTimeoutFrames === undefined
      ? {}
      : { buildTimeoutFrames: options.buildTimeoutFrames }),
    ...(options.meshPageBytes === undefined ? {} : { meshPageBytes: options.meshPageBytes }),
    ...(options.isBatched === true && !records ? { isBatched: true } : {}),
  };
  const pass: ScenePass = {
    isRootMoveOrderStable: true,
    name: options.name ?? defaultPathPassName(draws, records !== undefined),
    layout: resolveSceneInstanceLayout([
      ...PATH_RECORD_ATTRIBUTES,
      ...(records ? [{ location: 8, format: 'float32' } as const] : []),
    ]),
    pipelineSpec: {
      shader: records ? PATH_GRADIENT_SHADER : PATH_SHADER,
      moveShader: records ? PATH_GRADIENT_MOVE_SHADER : PATH_MOVE_SHADER,
      vertexLayout: { stepMode: 'vertex', attributes: [{ location: 0, format: 'float32x2' }] },
      vertices: NO_VERTICES,
      vertexCount: 0,
      blend: 'premultiplied',
      ...(records ? { pageBindings: PAINT_TABLE_BINDINGS } : {}),
    },
    recordCount(object: BoardObject): number {
      return layersOf(object).length;
    },
    // Every drawable layer of a path or line paints over lower content, including translucent
    // strokes. A connector occludes nothing, as text does: a thin line rarely hides what
    // is under it, and as an occluder each one over a label split the z-order segments, so a
    // board of connectors cost a segment and its draw calls apiece. Text under a connector then
    // draws over it; everything else under it still draws first.
    isOccluder(object: BoardObject): boolean {
      return draws === 'paths' && layersOf(object).length > 0;
    },
    prepare(record: Float32Array, target: SceneObject, recordIndex: number): void {
      const { object, transform } = target;
      if (!isDrawnPath(object)) return;
      const layer = pathLayersOf(object)[recordIndex];
      const isGradientFill = records !== undefined && layer === 'fill';
      const color = isGradientFill ? undefined : layerColorOf(object, layer, paletteOf(target));
      if (!color && !isGradientFill) return;
      // Field by field: prepare runs for every changed object, so it allocates nothing.
      record[0] = transform.cos;
      record[1] = transform.sin;
      record[2] = transform.x;
      record[3] = transform.y;
      if (records && isGradientFill) {
        writeGradientFill(record, target, records);
        return;
      }
      if (!color) return;
      record[4] = color[0];
      record[5] = color[1];
      record[6] = color[2];
      record[7] = color[3];
    },
    levelOfDetail: draws === 'paths' ? PATH_LEVEL_OF_DETAIL : CONNECTOR_LEVEL_OF_DETAIL,
    createDrawer: (setup) => new PathDrawer(setup, pass, drawerOptions),
    ...(records && gradientHooks(records)),
  };
  return pass;
}

/**
 * A pass's default name: `path`, `connector`, or `path-gradient` for the gradient variant.
 *
 * @param draws - What it draws.
 * @param isGradient - Whether it is the gradient variant.
 * @returns The name.
 */
function defaultPathPassName(draws: PathPassContent, isGradient: boolean): string {
  if (isGradient) return PATH_GRADIENT_PASS_NAME;
  return draws === 'paths' ? 'path' : 'connector';
}

/**
 * The gradient variant's paint-record hooks: its page entries (the paint table), its stage, and
 * forgetting, memory and freeing of its records.
 *
 * @param records - The pass's paint records.
 * @returns The hooks.
 */
function gradientHooks(records: GradientRecords): Partial<ScenePass> {
  return {
    pageEntries: () => records.pageEntries(),
    install: (frame) => {
      records.install(frame);
    },
    forget: (id) => {
      records.forget(id);
    },
    reportMemory: (ledger) => {
      records.reportMemory(ledger);
    },
    destroy: () => {
      records.destroy();
    },
  };
}

/**
 * Creates a path pass (CPU flattening with stencil even-odd fills), which draws paths and lines
 * (a line's shaft and heads are one stroke layer, meshed by `buildLineMesh`), or, with
 * `draws: 'connectors'`, connectors as lines. A path draws up to two layers, fill then
 * stroke (`pathLayersOf`), each a record of the rotation axis and world origin (`float32x4`,
 * location 1) and the layer's straight-alpha colour (`float32x4`, location 2; a stroke's `'ink'`
 * resolved to the viewer's ink), so a move or a recolour rewrites records and never a mesh. A path
 * whose fill is a gradient is the gradient variant's (`createGradientPathPass`), not this pass's.
 * The pass is a custom-draw pass: each renderer gets a `PathDrawer`, which meshes paths per zoom
 * bucket into a cache under the byte budget and draws each layer from its path's mesh. A path with
 * any drawable layer is flagged for z-order segmentation, including stroke-only paths and lines, so
 * it paints over later-pass content below it; a connector is not (it occludes nothing, as text
 * does).
 *
 * @param options - Its name, mesh builder, cache budget and per-frame meshing budget.
 * @returns The pass.
 */
export function createPathPass(options: PathPassOptions): ScenePass {
  return buildPathPass(options);
}

/** The gradient path pass's default name. */
export const PATH_GRADIENT_PASS_NAME = 'path-gradient';

/**
 * Creates the gradient variant of the path pass: paths whose fill is a
 * gradient the schema accepts, drawn as the path pass draws them (the same stencil fans and
 * stroke meshes), with the fill's cover quad coloured from the paint at the fragment's point of
 * the path's paint box (`paintBoxOf`: its network's bounds in its own frame) by `path-gradient`.
 * Its records are the path pass's plus the paint table record (`@location(8)`; 0 for a stroke
 * and for a fill in the chord form, which draws the paint's average colour). Built per renderer,
 * since it shares the renderer's paint table. List it right after the path pass.
 *
 * @param options - Its name, mesh builder, cache budget and per-frame meshing budget; `draws` is
 *   always paths.
 * @returns The pass factory.
 */
export function createGradientPathPass(options: PathPassOptions): ScenePassFactory {
  const name = options.name ?? PATH_GRADIENT_PASS_NAME;
  return {
    name,
    create: (environment) =>
      buildPathPass(
        { ...options, name, draws: 'paths' },
        new GradientRecords(name, environment, 'chord'),
      ),
  };
}
