import type { BoardObject, ObjectId } from '@canvas/schema';

import { atlasOwnerOf, reportGlyphAtlasMemory } from '../../diagnostics/glyph-atlas-memory.js';
import type { MemoryLedger } from '../../diagnostics/memory-ledger.js';
import type { GpuBindGroupEntry } from '../../gpu/gpu-bind-group.js';
import type { LevelOfDetail } from '../../lod/level-of-detail.js';
import type { FrameContext } from '../../scene/frame-context.js';
import type { Frame } from '../../scene/frame.js';
import type {
  SceneObject,
  ScenePass,
  ScenePassEnvironment,
  ScenePassFactory,
} from '../../scene/scene-pass.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { GlyphSource } from '../msdf/glyph-source.js';

import { dropTextEntry } from './drop-text-entry.js';
import { framedJobs } from './framed-jobs.js';
import { dropTextBounds, publishTextBounds, retainTextTarget } from './retained-text-target.js';
import { TextAtlasChanges } from './text-atlas-changes.js';
import { loanedTextAtlas } from './text-atlas-loan.js';
import { TextAtlasPages } from './text-atlas-pages.js';
import { TextDetailQueue } from './text-detail-queue.js';
import { fontsKeyOf, TextLayoutCache } from './text-layout-cache.js';
import { hasTierChange, isSamePlacement, type TextObjectEntry } from './text-object-entry.js';
import { TextObjectQuads } from './text-object-quads.js';
import {
  inertTextPass,
  TEXT_PASS_KIND,
  TEXT_PASS_NAME,
  type TextPassKind,
} from './text-pass-definition.js';
import type { TextPassResources } from './text-pass-resources.js';
import { TextPreviewReadiness } from './text-preview-readiness.js';
import { registerTextRecordBatch } from './text-record-batch.js';
import { TextRecordCounts } from './text-record-count.js';
import { retainedTextPatch } from './text-record-patch.js';
import { placedGroup, TEXT_RECORD_LAYOUT, writePlacedGlyph } from './text-record.js';
import { TextTierChecks } from './text-tier-checks.js';
import { registerTextVector, type TextVectorState } from './text-vector-state.js';

export { TEXT_PASS_NAME, textRecordCount } from './text-pass-definition.js';

/** The stage before `collectChanges` that starts the text pass's frame. */
export const TEXT_BEGIN_STAGE_NAME = 'textBegin';

/** The stage after `collectChanges` that rewrites text whose drawing changed. */
export const TEXT_REFRESH_STAGE_NAME = 'textRefresh';

/** Rendering-thread text state: layout jobs, glyph records, atlas, paged draws. */
class TextScenePass implements ScenePass {
  readonly isRootMoveOrderStable = true;
  readonly name: string;
  readonly layout = TEXT_RECORD_LAYOUT;
  readonly pipelineSpec: TextPassKind['pipelineSpec'];
  readonly levelOfDetail: TextPassKind['levelOfDetail'];
  readonly isOutsideLayers: boolean;
  private readonly entries = new Map<ObjectId, TextObjectEntry>();
  private readonly recordCounts: TextRecordCounts;
  private readonly patchValues = new Float32Array(4);
  private readonly quads: TextObjectQuads;
  private readonly atlas: GlyphAtlas;
  private readonly glyphs: GlyphSource;
  private readonly layouts: TextLayoutCache;
  private readonly pages: TextAtlasPages;
  private readonly landed = new Set<ObjectId>();
  private readonly tierChecks = new TextTierChecks();
  private readonly preview: TextPreviewReadiness;
  /** Text drawn in glyphs still waiting for one at its tier: rewritten when glyphs land. */
  private readonly incomplete = new Set<ObjectId>();
  /** Text whose glyphs-or-bars form changed, rewritten a budget a frame. */
  private readonly detailQueue: TextDetailQueue;
  /** The frame's text to rewrite, and its targets, reused from frame to frame. */
  private readonly stale = new Set<ObjectId>();
  private readonly staleTargets: SceneObject[] = [];
  private readonly lod: LevelOfDetail | undefined;
  /** The vector glyph tier, when the resources ask for it: the text kind's only. */
  private readonly vector: TextVectorState | undefined;
  /** Sets the atlas's budget for the frame from the textures' loan. */
  private readonly borrow: () => void;
  private scale = 1;
  private fontsKey = '';
  private readonly atlasChanges: TextAtlasChanges;
  private dropped = 0;
  readonly pageEntries = (page: number): readonly GpuBindGroupEntry[] => this.pages.entriesOf(page);
  readonly pageSlotsOf = (page: number): number => this.pages.slotsOf(page);

  constructor(
    private readonly environment: ScenePassEnvironment,
    private readonly resources: TextPassResources,
    private readonly kind: TextPassKind,
  ) {
    this.name = kind.name;
    this.pipelineSpec = kind.pipelineSpec;
    this.levelOfDetail = kind.levelOfDetail;
    this.isOutsideLayers = kind.isOutsideLayers === true;
    this.recordCounts = new TextRecordCounts(kind.textOf, kind.runsOf, kind.paragraphsOf);
    this.detailQueue = new TextDetailQueue(
      resources.detailRewritesPerFrame,
      environment.requestFrame,
    );
    ({ atlas: this.atlas, borrow: this.borrow } = loanedTextAtlas(environment, resources, kind));
    this.atlasChanges = new TextAtlasChanges(this.atlas, kind);
    const jobs = framedJobs(resources.jobs, environment.requestFrame);
    this.glyphs = new GlyphSource({
      pool: jobs,
      fonts: resources.fonts,
      atlas: this.atlas,
      onGlyphsReady: environment.requestFrame,
    });
    this.quads = new TextObjectQuads(this.atlas, this.glyphs);
    this.layouts = new TextLayoutCache(
      resources,
      (id) => {
        this.landed.add(id);
        environment.requestFrame();
      },
      environment.requestFrame,
    );
    this.pages = new TextAtlasPages(environment.backend, this.atlas, kind.pagesPerGroup);
    const quadsOf = (target: SceneObject) => this.entryFor(target)?.quads?.quads;
    registerTextRecordBatch(this, quadsOf, this.pages, kind.recordValueOf);
    const isText = kind.name === TEXT_PASS_NAME;
    this.vector = registerTextVector(environment, { ...resources, jobs }, isText, this.landed);
    this.fontsKey = fontsKeyOf(resources.fonts);
    this.lod = environment.levelOfDetail;
    this.preview = new TextPreviewReadiness(
      this,
      resources.fonts,
      {
        entries: this.entries,
        layouts: this.layouts,
        atlas: this.atlas,
        pages: this.pages,
        glyphs: this.glyphs,
        landed: this.landed,
        incomplete: this.atlasChanges.incompleteText(this.incomplete),
        detailQueue: this.detailQueue.ids,
      },
      () => this.fontsKey,
    );
  }

  /**
   * Glyphs not drawn: a shaped layout had more than its text's records; else 0.
   *
   * @returns The count.
   */
  get droppedGlyphs(): number {
    return this.dropped;
  }

  recordCount(object: BoardObject): number {
    return this.recordCounts.read(object);
  }

  prepare(record: Float32Array, target: SceneObject, recordIndex: number): void {
    const placed = this.entryFor(target)?.quads?.quads[recordIndex];
    writePlacedGlyph(record, target, placed, this.pages, this.kind.recordValueOf?.(target.object));
  }

  /**
   * Refreshes placement without consuming pending layout or glyph invalidations.
   *
   * @param target - The latest geometry-preserving absolute placement.
   */
  retainMoveTarget(target: SceneObject): void {
    retainTextTarget(this.entries, target, this.environment.setTextBounds, this.kind, this.scale);
  }

  preparePatch(target: SceneObject): ReturnType<NonNullable<ScenePass['preparePatch']>> {
    // The patch moves only the origin: a record value of the pass's own is rewritten.
    if (this.kind.recordValueOf !== undefined) return undefined;
    const before = this.entries.get(target.object.id)?.quads;
    const after = this.entryFor(target)?.quads;
    return retainedTextPatch(
      before,
      after,
      target.transform,
      this.recordCount(target.object),
      this.patchValues,
    );
  }

  pageOf(target: SceneObject, recordIndex: number): number {
    return placedGroup(this.entries.get(target.object.id)?.quads?.quads[recordIndex], this.pages);
  }

  install(frame: Frame): void {
    // The text pass keeps its stage names; another kind's are prefixed with its own name.
    const isText = this.name === TEXT_PASS_NAME;
    frame.insertStage('before', 'collectChanges', {
      name: isText ? TEXT_BEGIN_STAGE_NAME : `${this.name}Begin`,
      run: (context) => {
        this.begin(context);
      },
    });
    frame.insertStage('after', 'collectChanges', {
      name: isText ? TEXT_REFRESH_STAGE_NAME : `${this.name}Refresh`,
      run: (context) => {
        this.refresh(context);
      },
    });
  }

  forget(id: ObjectId): void {
    dropTextEntry(this.entries, id, this.kind, this.environment.setTextBounds);
    this.atlasChanges.forget(id);
    this.recordCounts.forget(id);
    this.layouts.forget(id);
    this.landed.delete(id);
    this.incomplete.delete(id);
    this.detailQueue.delete(id);
    this.tierChecks.forget(id);
    this.vector?.forget(id);
  }

  reportMemory(ledger: MemoryLedger): void {
    reportGlyphAtlasMemory(this.atlas, ledger, atlasOwnerOf(this.name, TEXT_PASS_NAME));
  }

  destroy(): void {
    for (const [id, entry] of this.entries) {
      dropTextBounds(id, entry.target.object, this.kind, this.environment.setTextBounds);
    }
    this.entries.clear();
    this.vector?.clear();
    this.detailQueue.clear();
    this.recordCounts.clear();
    this.pages.destroy();
  }

  /**
   * Starts a frame: glyphs used from now on are safe from eviction, a new scale that may change
   * a tier queues the text for a tier check, and a new set of faces marks every text.
   *
   * @param context - The frame.
   */
  private begin(context: FrameContext): void {
    this.quads.beginFrame(context.stats);
    this.preview.observeFonts();
    this.atlas.beginFrame(context.timeMs);
    this.borrow();
    context.stats.atlasRegenerations += this.atlasChanges.takeRegenerations();
    const scale = this.kind.scaleOf(context.camera);
    if (scale !== this.scale) {
      this.tierChecks.rescale(this.scale, scale, this.entries.keys());
      this.scale = scale;
      if (this.kind.isBoundsScaled === true) {
        publishTextBounds(this.entries, this.kind, scale, this.environment.setTextBounds);
      }
    }
    const fontsKey = fontsKeyOf(this.resources.fonts);
    // A face added or replaced drops the vector geometry: every text is built again.
    if (this.vector?.beginFrame() === true || fontsKey !== this.fontsKey) {
      this.fontsKey = fontsKey;
      for (const id of this.entries.keys()) this.landed.add(id);
    }
  }

  /**
   * Rewrites the records of text whose drawing changed with no document change: a layout that
   * landed, glyphs that landed or were evicted, a level of detail between glyphs and greek bars,
   * a tier change of text the frame draws; then mirrors the atlas onto the GPU.
   *
   * @param context - The frame.
   */
  private refresh(context: FrameContext): void {
    const { stale, staleTargets: targets } = this;
    stale.clear();
    targets.length = 0;
    for (const id of this.landed) stale.add(id);
    this.landed.clear();
    const { levelOfDetail } = context.scene;
    this.atlasChanges.collect(this.entries, this.incomplete, stale, levelOfDetail);
    this.detailQueue.add(levelOfDetail.changedIn(this.name));
    this.vector?.noteDetailChanges(levelOfDetail, stale);
    // A text drawn in the other form (an entry's isGreek differs) is due; a gone one is not.
    this.detailQueue.take((id) => this.entries.get(id)?.isGreek === !this.isGreek(id), stale);
    for (const id of this.tierChecks.due(levelOfDetail)) {
      const entry = this.entries.get(id);
      if (entry?.isGreek === false && hasTierChange(entry, this.scale, this.vector)) stale.add(id);
    }
    for (const id of stale) {
      const entry = this.entries.get(id);
      if (entry === undefined) continue;
      entry.isStale = true;
      targets.push(entry.target);
    }
    if (targets.length > 0) context.scene.rewriteRecords(this.name, targets);
    this.pages.sync();
  }

  /**
   * Whether an object's text draws as greek bars now: in the `greek` form, or `hidden`, whose
   * records stay greek so the text shows again without a rewrite.
   *
   * @param id - The object.
   * @returns True unless it draws in full.
   */
  private isGreek(id: ObjectId): boolean {
    return (this.lod?.formOf(this.name, id) ?? 'full') !== 'full';
  }

  /**
   * The object's entry, brought up to date with a target the scene prepares: its box, its
   * layout and glyph quads. Standard hosts resolve this once per object record batch.
   *
   * @param target - The object and transform being prepared.
   * @returns The entry; `undefined` for an object that draws no text.
   */
  private entryFor(target: SceneObject): TextObjectEntry | undefined {
    const { id } = target.object;
    const existing = this.entries.get(id);
    const isGreek = this.isGreek(id);
    if (existing?.target === target && !existing.isStale && existing.isGreek === isGreek) {
      return existing;
    }
    const geometry = this.kind.placementOf(target.object);
    if (geometry === undefined) {
      // No text here any more (a frame's name hidden): its entry and reach go.
      dropTextEntry(this.entries, id, this.kind, this.environment.setTextBounds);
      return undefined;
    }
    const entry: TextObjectEntry = existing ?? {
      target,
      geometry,
      builtLayout: undefined,
      quads: undefined,
      isStale: true,
      isGreek,
    };
    const isGeometryChanged = !isSamePlacement(entry.geometry, geometry);
    const { hasDrawingBounds } = this.kind;
    if (hasDrawingBounds(entry.target.object) && !hasDrawingBounds(target.object)) {
      this.environment.setTextBounds?.(id, undefined);
    }
    entry.target = target;
    entry.geometry = geometry;
    this.entries.set(id, entry);
    this.tierChecks.noteFontSizes(geometry.runs.map(({ style }) => style.fontSize));
    const layout = this.layouts.layoutOf(id, geometry, this.fontsKey);
    if (
      layout !== undefined &&
      (entry.isStale ||
        isGeometryChanged ||
        layout !== entry.builtLayout ||
        entry.isGreek !== isGreek)
    ) {
      const vector = this.vector?.policyFor(id, this.lod);
      entry.quads = this.quads.get(entry, layout, isGreek, this.scale, vector);
      this.vector?.note(id, entry, layout, entry.quads);
      this.dropped += Math.max(0, entry.quads.quads.length - this.recordCount(target.object));
      entry.builtLayout = layout;
      entry.isGreek = isGreek;
    }
    if (hasDrawingBounds(target.object)) {
      this.environment.setTextBounds?.(id, this.kind.drawingBoundsOf(entry, this.scale));
    }
    entry.isStale = false;
    if (entry.quads?.isComplete === false) this.incomplete.add(id);
    else this.incomplete.delete(id);
    return entry;
  }
}

/**
 * The scene's text pass, built per renderer: text objects' glyphs as instance records, one
 * per character that is neither a space nor a newline, drawn with the MSDF shader in their object's
 * frame (so text turns with its object) from the glyph atlas, one draw per page group per z-order
 * segment. Layout runs through the job pool at `visible` priority from a per-object cache keyed by
 * the text, runs, wrapping width, alignment and loaded faces, and the previous layout draws until
 * the new one lands; glyphs come through the tier cascade and are generated by `msdf` jobs; a zoom
 * that takes a font size across a tier edge rewrites only the drawn text whose tier changes. Where
 * each box sits is `textPlacementOf`. Text occludes nothing. Level of detail (
 * `TEXT_LEVEL_OF_DETAIL`): text whose tallest line is under 4 device pixels draws as greek bars
 * (`greekQuads`, no atlas) and under 2.5 is left out by the z-order segments, with a 20% band per
 * object. Without text resources in the environment (fonts and a job pool) the pass draws nothing.
 */
export const TEXT_PASS: ScenePassFactory = textPassFactory(TEXT_PASS_KIND);

/**
 * A scene pass factory for a kind of text (`TextPassKind`): the text machinery with the kind's
 * name, pipeline, level of detail and placement. Without text resources in the environment
 * (fonts and a job pool) the pass draws nothing.
 *
 * @param kind - The kind.
 * @returns The factory.
 */
export function textPassFactory(kind: TextPassKind): ScenePassFactory {
  return {
    name: kind.name,
    create(environment) {
      const { text } = environment;
      return text === undefined ? inertTextPass(kind) : new TextScenePass(environment, text, kind);
    },
  };
}
