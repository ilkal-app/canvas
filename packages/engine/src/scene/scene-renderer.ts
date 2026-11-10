import type { InkTheme, ObjectId } from '@canvas/schema';

import {
  isSameCamera,
  visibleWorldBounds,
  type Camera,
  type WorldBounds,
} from '../camera/camera.js';
import { ConnectorRouting } from '../connectors/connector-routing.js';
import type { UndrawableReport } from '../drawable/drawable-extent.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuColor } from '../gpu/gpu-render-pass.js';
import { createLevelOfDetailStage } from '../lod/level-of-detail-stage.js';
import { LevelOfDetail } from '../lod/level-of-detail.js';
import { lodPreviewKey } from '../lod/lod-preview-key.js';
import type { ColorTokenValues } from '../paint/color-palette.js';
import { SpatialCuller } from '../spatial/spatial-culler.js';
import type { StickyAuthors } from '../text/scene/sticky-author-box.js';

import {
  COLLECT_CHANGES_STAGE,
  createCullStage,
  createDrawStage,
  SUBMIT_STAGE,
  UPLOAD_DIRTY_RANGES_STAGE,
} from './built-in-stages.js';
import { CameraUniform } from './camera-uniform.js';
import { ClipTableTexture } from './clip-table-texture.js';
import { DEFAULT_SCENE_PASSES } from './default-scene-passes.js';
import {
  emptyFrameStats,
  NO_FRAME_TIMERS,
  type FrameStats,
  type FrameTimerHook,
} from './frame-context.js';
import { Frame } from './frame.js';
import { createLayersStage } from './layers/layers-stage.js';
import { capturePreviewBackground } from './preview-background.js';
import { placementHooksOf } from './retained-placement-hooks.js';
import { RetainedSceneMove } from './retained-scene-move.js';
import { SceneChangeQueue } from './scene-change-queue.js';
import type { SceneCuller } from './scene-culler.js';
import { createScenePassResources, type ScenePassResources } from './scene-pass-resources.js';
import { resolveScenePasses, type ScenePass } from './scene-pass.js';
import {
  captureScenePreviewStructure,
  isScenePreviewStructureCurrent,
  readScenePreviewResources,
  type CertifiedPreviewResources,
} from './scene-preview-resources.js';
import { SceneReading } from './scene-reading.js';
import {
  DEFAULT_CHURN_BUDGET,
  sceneOptionsOf,
  type ChurnBudget,
  type FrameInput,
  type InkColors,
  type SceneRendererOptions,
} from './scene-renderer-options.js';
import type { SceneChangeSet } from './scene-source.js';
import { Scene } from './scene.js';
import { ZOrderSegments } from './segments/z-order-segments.js';
import { installUploadStages } from './upload-stages.js';

export type { FrameInput, InkColors, SceneRendererOptions } from './scene-renderer-options.js';

const DEFAULT_CLEAR_COLOR: GpuColor = [0.98, 0.98, 0.98, 1];

/**
 * The engine's frame driver: a {@link Scene} mirroring the document, one set of GPU resources
 * per pass, the camera uniform, and the {@link Frame} whose stages turn them into pixels.
 * Push document change sets with `enqueue` as they arrive and
 * call `renderFrame` once per animation frame; extend the frame through `frame`. Runs on the
 * thread that owns the backend.
 */
export class SceneRenderer {
  /** The scene graph and its instance buffers. */
  readonly scene: Scene;
  /** The frame's stages: the extension point (`insertStage`, `wrapStage`). */
  readonly frame: Frame;
  /** Change sets waiting for the next frame. */
  readonly changes = new SceneChangeQueue();
  /** How the scene reads each queued change set: drawable gate, frame names, author labels. */
  private readonly reading = new SceneReading(() => this.scene.hierarchy);
  private readonly culler: SceneCuller;
  private readonly backend: GpuBackend;
  private readonly cameraUniform: CameraUniform;
  private readonly clipTable: ClipTableTexture;
  private readonly passes: readonly ScenePassResources[];
  private readonly builtPasses: readonly ScenePass[];
  private readonly clearColor: GpuColor;
  private readonly timers: FrameTimerHook;
  private frameIndex = 0;
  private readonly retainedMove: RetainedSceneMove;
  private drawnCamera: Camera | undefined;
  private readonly isPreviewBackgroundCurrent: () => boolean;

  /**
   * Creates the scene and every pass's GPU resources.
   *
   * @param backend - The backend to draw through.
   * @param options - Passes, their environment, culling, clear colour, timers and buffer
   *   options.
   * @throws {RangeError} When two passes share a name.
   */
  constructor(backend: GpuBackend, options: SceneRendererOptions = {}) {
    this.backend = backend;
    this.isPreviewBackgroundCurrent = capturePreviewBackground(options.background, options.timers);
    // The scene keeps each object's level of detail; the passes read it as they write records.
    const { churnBudget, environment: { ledger } = {} } = options;
    const churn: ChurnBudget = churnBudget ? { ...DEFAULT_CHURN_BUDGET, ...churnBudget } : {};
    const levelOfDetail = new LevelOfDetail({ changesPerFrame: churn.lodChangesPerFrame });
    const culler = options.culler ?? new SpatialCuller({ entriesPerFrame: churn.entriesPerFrame });
    this.culler = culler;
    this.builtPasses = resolveScenePasses(options.passes ?? DEFAULT_SCENE_PASSES, {
      requestFrame: () => undefined,
      now: () => 0,
      ...options.environment,
      levelOfDetail,
      backend,
      ...(culler instanceof SpatialCuller && {
        setTextBounds: (id, bounds) => {
          culler.setDrawingBounds(id, bounds);
          options.environment?.setTextBounds?.(id, bounds);
        },
      }),
    });
    this.scene = new Scene(
      this.builtPasses,
      sceneOptionsOf(options, this.builtPasses, levelOfDetail),
    );
    this.cameraUniform = new CameraUniform(backend);
    this.clipTable = new ClipTableTexture(backend, this.scene.clipTable);
    this.passes = createScenePassResources(backend, this.scene, this.cameraUniform, this.clipTable);
    this.retainedMove = new RetainedSceneMove(backend, this.scene, this.passes, ledger);
    this.clearColor = options.clearColor ?? DEFAULT_CLEAR_COLOR;
    this.timers = options.timers ?? NO_FRAME_TIMERS;
    this.frame = new Frame([
      COLLECT_CHANGES_STAGE,
      UPLOAD_DIRTY_RANGES_STAGE,
      createCullStage(culler),
      createDrawStage(options.timingLabel, options.background),
      SUBMIT_STAGE,
    ]);
    // A culler that is not fed the change sets would cull against a stale index, so a
    // SpatialCuller is installed whether it is the default or the caller's.
    if (culler instanceof SpatialCuller) culler.install(this.frame);
    if (options.isZOrdered ?? true) {
      // The culler's index gives each object's box, so occluders over nothing share segments.
      const spatial = culler instanceof SpatialCuller ? culler.index : undefined;
      new ZOrderSegments({
        ...(spatial === undefined ? {} : { spatial }),
        ...(culler.rangeChangeOf && {
          rangeChangeOf: (name) => culler.rangeChangeOf?.(name),
        }),
      }).install(this.frame);
    }
    for (const pass of this.builtPasses) pass.install?.(this.frame);
    // Inserted after the passes' stages, so it runs first after `collectChanges`: forms are
    // current before any pass rewrites records.
    this.frame.insertStage(
      'after',
      'collectChanges',
      createLevelOfDetailStage((viewport) =>
        culler instanceof SpatialCuller ? culler.visibilityFor(viewport) : undefined,
      ),
    );
    // Custom-draw passes hook in last, so a stage they insert before `draw` sees the final list.
    for (const pass of this.passes) pass.drawer?.install(this.frame);
    // Last before `draw`, after the drawers' stages: layers draw meshes and glyphs they prepared.
    this.frame.insertStage('before', 'draw', createLayersStage(this.passes));
    installUploadStages(this.frame, this.retainedMove, this.clipTable);
    // Outermost on `collectChanges`, so every reader above sees connectors with their routes.
    const routing = new ConnectorRouting();
    routing.install(this.frame);
    this.retainedMove.usePlacementHooks(placementHooksOf(culler, routing, this.scene));
    captureScenePreviewStructure(this, this.frame);
  }

  /**
   * Switches the viewer's theme: objects in no explicit colour mode draw `'ink'` and tokens in its
   * values; only records whose colours change are rewritten (no text layout, path mesh or document
   * read). Viewer-local. The caller asks for a frame.
   *
   * @param theme - The viewer's theme.
   * @param inkColors - What ink draws as per theme, if it changed; default the current ones.
   * @returns How many instance records changed.
   */
  setTheme(theme: InkTheme, inkColors?: InkColors): number {
    return this.redrawColors(this.scene.setTheme(theme, inkColors));
  }

  /**
   * Replaces the board's colour token values: records naming a token whose value changed
   * are rewritten as {@link SceneRenderer.setTheme} rewrites them. The caller asks for a frame.
   *
   * @param table - Each custom token and edited built-in by id, with its light and dark values.
   * @returns How many instance records changed.
   */
  setColorTokens(table: ColorTokenValues): number {
    return this.redrawColors(this.scene.setTokens(table));
  }

  /**
   * Replaces the board's sticky authors, queuing only stickies whose label changed.
   *
   * @param authors - The authors.
   * @returns How many stickies' labels changed.
   */
  setStickyAuthors(authors: StickyAuthors): number {
    return this.reading.setStickyAuthors(authors, this.changes);
  }

  private redrawColors(changed: number): number {
    if (changed > 0) this.drawnCamera = undefined; // The frame drawn before is stale.
    return changed;
  }

  /**
   * Whether a pass has work in hand that a later frame would show (path meshes being built), so
   * the frame loop should draw again even when nothing else changed.
   *
   * @returns True while work is pending.
   */
  hasPendingWork(): boolean {
    return (
      this.passes.some((pass) => pass.drawer?.hasPendingWork() ?? false) ||
      (this.culler instanceof SpatialCuller && this.culler.hasPendingAdmissions()) ||
      this.scene.levelOfDetail.hasPendingChanges() ||
      this.frame.hasPendingWork()
    );
  }

  /**
   * Reads indexed candidates for a preview without changing the active culling query.
   * Includes known asynchronous drawing bounds; the caller must separately establish font
   * and asset readiness and add complete render dependencies before persisting a preview.
   * This is not a readiness or snapshot-version certificate.
   *
   * @param bounds - The preview's coverage in world units.
   * @returns Candidates, or undefined for queued changes or a non-spatial culler.
   */
  projectionCandidates(bounds: WorldBounds): readonly ObjectId[] | undefined {
    if (this.changes.size > 0 || !(this.culler instanceof SpatialCuller)) return undefined;
    return this.culler.index.searchRect(bounds);
  }

  /**
   * Reads all installed resource contributors after a successful unchanged built-in frame.
   * Unknown passes, backgrounds and content-stage extensions are ineligible.
   *
   * @param camera - Requested drawn camera.
   * @param fontSetKey - Expected immutable font catalogue.
   * @param candidates - The objects the preview holds, its LOD key's scope; default all visible.
   * @returns Complete resource evidence, or undefined; host scene identity is still required.
   */
  readPreviewResources(
    camera: Camera,
    fontSetKey: string,
    candidates?: readonly ObjectId[],
  ): CertifiedPreviewResources | undefined {
    if (
      this.drawnCamera === undefined ||
      !isSameCamera(camera, this.drawnCamera) ||
      this.changes.size > 0 ||
      !this.isPreviewBackgroundCurrent() ||
      !isScenePreviewStructureCurrent(this)
    )
      return undefined;
    const resources = readScenePreviewResources(
      this.passes,
      camera,
      this.frameIndex - 1,
      fontSetKey,
      candidates,
    );
    if (resources === undefined) return undefined;
    const lodPasses = this.builtPasses
      .filter((pass) => pass.levelOfDetail !== undefined)
      .map((pass) => pass.name);
    const lodPlanKey = lodPreviewKey(this.scene.levelOfDetail, lodPasses, candidates);
    if (lodPlanKey === undefined) return undefined;
    return {
      ...resources,
      lodPlanKey,
      isCurrent: () =>
        resources.isCurrent() &&
        this.drawnCamera !== undefined &&
        isSameCamera(camera, this.drawnCamera) &&
        this.changes.size === 0 &&
        this.frameIndex - 1 === resources.frameIndex &&
        this.isPreviewBackgroundCurrent() &&
        lodPreviewKey(this.scene.levelOfDetail, lodPasses, candidates) === lodPlanKey &&
        isScenePreviewStructureCurrent(this),
    };
  }

  /**
   * Queues a document change set for the next frame, through the renderer's `DrawableGate`: an
   * object whose geometry is not drawable (a number that is not finite, a negative size,
   * a place past `DRAWABLE_EXTENT`, or an undrawable frame or group around it) is judged here,
   * once per change, and is absent for everything the frame does with the change set.
   *
   * @param changes - The change set, in the order the document produced it.
   */
  enqueue(changes: SceneChangeSet): void {
    const restore = this.retainedMove.interrupt(changes);
    if (restore) this.changes.push(this.reading.read(restore));
    this.changes.push(this.reading.read(changes));
  }

  /**
   * Queues exact root move positions while retaining prepared geometry after the first frame.
   *
   * @param changes - The current absolute preview objects.
   * @param ids - Stable root membership, already checked by the host session.
   */
  enqueueRetainedMove(changes: SceneChangeSet, ids: readonly ObjectId[]): void {
    // A trusted update of a placing session goes straight to the table.
    if (this.retainedMove.placeOnly(ids, changes)) return;
    const drawable = this.reading.gate.filter(changes);
    const restore = this.retainedMove.request(ids, drawable);
    if (!restore) {
      this.changes.push(this.reading.label(drawable));
      return;
    }
    this.changes.push(this.reading.read(restore));
    // Judged again after the restoration, still listing what the first judgement flipped.
    const again = this.reading.gate.filter(changes);
    const updated = [...new Set([...drawable.updated, ...again.updated])];
    const queued = updated.length === again.updated.length ? again : { ...again, updated };
    this.changes.push(this.reading.label(queued));
  }

  /**
   * A retained-move member's drawn placement, for tests and diagnostics.
   *
   * @param id - The member.
   * @returns Its table placement moved by the session's translation, or undefined.
   */
  retainedPlacementOf(id: ObjectId): ReturnType<RetainedSceneMove['placementOf']> {
    return this.retainedMove.placementOf(id);
  }

  /**
   * Takes the objects found undrawable since the last call, each once per change that touched
   * it: what the engine hosts report with each frame (`EngineFrameReport.undrawable`), at most
   * `MAX_REPORTED_UNDRAWABLE` listed, with their count.
   *
   * @returns The report; empty, with a count of 0, when none was found.
   */
  takeUndrawable(): UndrawableReport {
    return this.reading.gate.takeReport();
  }

  /**
   * Runs one frame: every stage of {@link SceneRenderer.frame}, in order.
   *
   * @param input - The frame's time and camera.
   * @returns What the frame did.
   * @throws {Error} Whatever a stage throws.
   */
  renderFrame(input: FrameInput): FrameStats {
    this.drawnCamera = undefined;
    const stats = emptyFrameStats();
    this.frame.run({
      timeMs: input.timeMs,
      frameIndex: this.frameIndex,
      camera: input.camera,
      viewport: visibleWorldBounds(input.camera),
      backend: this.backend,
      timers: this.timers,
      changes: this.changes,
      scene: this.scene,
      instanceBuffers: this.scene.instanceBuffers,
      passes: this.passes,
      cameraUniform: this.cameraUniform,
      clipTable: this.clipTable,
      drawList: [],
      layers: [],
      clearColor: this.clearColor,
      stats,
    });
    this.drawnCamera = { ...input.camera };
    this.frameIndex += 1;
    return stats;
  }

  /** Frees every GPU resource the renderer created; the backend itself stays alive. */
  destroy(): void {
    this.retainedMove.stop();
    this.drawnCamera = undefined;
    for (const pass of this.passes) pass.destroy();
    for (const pass of this.builtPasses) pass.destroy?.();
    this.cameraUniform.destroy();
    this.clipTable.destroy();
  }
}
