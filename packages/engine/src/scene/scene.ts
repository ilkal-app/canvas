import type { BoardObject, ColorMode, ObjectId, Rgba } from '@canvas/schema';

import { LevelOfDetail } from '../lod/level-of-detail.js';
import type { ColorTokenValues, InkColors } from '../paint/color-palette.js';

import type { ClipTable } from './clip-table.js';
import { ColorTargets } from './color-targets.js';
import type { InstanceBuffer } from './instance-buffer.js';
import { createPassStates, type PassState } from './pass-state.js';
import { getRootMoveBatch } from './root-move-batch.js';
import { canApplyRootMove } from './root-move-members.js';
import { compactPassSlots } from './scene-compaction.js';
import { SceneHandleTables, type SceneHandles } from './scene-handles.js';
import { SceneHierarchy } from './scene-hierarchy.js';
import { SceneLayerFallbacks, type SceneLayerOpacity } from './scene-layer-fallbacks.js';
import type { SceneOptions } from './scene-options.js';
import { removeRecords, upsertRecords, type PassRecordsHost } from './scene-pass-records.js';
import type { SceneObject, ScenePass } from './scene-pass.js';
import { SceneRecordTails } from './scene-record-tails.js';
import { rewriteTargets, writeSlotRecords } from './scene-records.js';
import type { SceneChangeSet, SceneSource } from './scene-source.js';
import { worldTransformOf } from './world-transform.js';

export type { SceneOptions } from './scene-options.js';

/**
 * The retained scene graph: a mirror of the document keeping every
 * object's records in each pass's persistent {@link InstanceBuffer}. {@link Scene.apply} rewrites
 * changed objects and descendants; unchanged frames find buffers clean. CPU-only.
 */
export class Scene {
  /** The passes, in draw order. */
  readonly passes: readonly ScenePass[];
  /**
   * Each drawn object's level-of-detail form per pass with a rule, kept in step with
   * what each pass draws; the frame's `levelOfDetail` stage updates it for the camera.
   */
  readonly levelOfDetail: LevelOfDetail;
  private readonly states: readonly PassState[];
  private readonly buffersByName: ReadonlyMap<string, InstanceBuffer>;
  /** Every mirrored object's parent and children, drawn or not. */
  readonly hierarchy = new SceneHierarchy();
  private retainedMove: ((target: SceneObject) => boolean) | undefined;
  private slotRevision = 0;
  private compactions = 0;
  /** The target each object's records were last prepared from, for compaction. */
  private readonly targets = new Map<ObjectId, SceneObject>();
  private readonly records: PassRecordsHost;
  /** Dense object handles and the per-pass slot tables they index. */
  readonly handles: SceneHandles;
  private readonly handleSlots: SceneHandleTables;
  private readonly colors: ColorTargets;
  private readonly tails: SceneRecordTails;
  /** The layers drawn in the multiply form, and what that multiplies records by. */
  readonly layerOpacity: SceneLayerOpacity;

  /**
   * Creates an empty scene.
   *
   * @param passes - The passes, in draw order; each gets one instance buffer.
   * @param options - Instance buffer options and the level-of-detail state.
   * @throws {RangeError} When two passes share a name.
   */
  constructor(passes: readonly ScenePass[], options: SceneOptions = {}) {
    this.passes = passes;
    this.levelOfDetail = options.levelOfDetail ?? new LevelOfDetail();
    this.levelOfDetail.register(passes);
    this.colors = new ColorTargets(options);
    this.tails = new SceneRecordTails(options.isLayerFormDrawn === true);
    this.states = createPassStates(passes, options.instanceBuffer);
    this.buffersByName = new Map(this.states.map(({ pass, buffer }) => [pass.name, buffer]));
    this.handles = this.handleSlots = new SceneHandleTables(this.states);
    this.records = {
      levelOfDetail: this.levelOfDetail,
      handles: this.handleSlots,
      tails: this.tails,
      nextRevision: () => ++this.slotRevision,
      write: (state, target, slots) => this.writeRecords(state, target, slots),
    };
    this.layerOpacity = new SceneLayerFallbacks(this.tails.opacity, this.hierarchy, this.states);
  }

  /**
   * Installs the renderer-owned, geometry-preserving move handler after slot preflight.
   *
   * @param handler - Retained placement handler, or undefined for ordinary preparation.
   * @returns What gives a target its current palette, for placements made outside `apply`.
   */
  useRetainedMove(
    handler: ((target: SceneObject) => boolean) | undefined,
  ): (target: SceneObject) => SceneObject {
    this.retainedMove = handler;
    return (target) => this.colors.current(target);
  }

  /**
   * Re-slots one pass's records of the listed objects, in the given order: into the
   * lowest free slots, or with `isFresh` past every slot handed out (`compactPassSlots`), for the
   * z-order segments' compaction, so slots follow paint order and draws stay few. Unlisted
   * objects keep their slots; the moved ones get fresh slot revisions, and
   * {@link Scene.compactionRevision} goes up. Nothing moves while a retained move places records.
   *
   * @param passName - The pass.
   * @param ids - The objects, in the order their records should take.
   * @param isFresh - Whether to append past every slot handed out instead (`allocateFresh`).
   * @returns How many records were re-slotted.
   * @throws {RangeError} When no pass has that name.
   */
  compactSlots(passName: string, ids: readonly ObjectId[], isFresh = false): number {
    const state = this.stateOf(passName);
    if (this.retainedMove) return 0;
    const index = this.states.indexOf(state);
    const targetOf = (id: ObjectId): SceneObject | undefined => this.targets.get(id);
    const records = compactPassSlots(this.records, state, index, ids, targetOf, isFresh);
    if (records > 0) this.compactions += 1;
    return records;
  }

  /**
   * Goes up whenever `compactSlots` moved records, so slot caches fed only by change sets (the
   * culler's ranges, the z-order slot owners) know to rebuild.
   *
   * @returns The revision.
   */
  get compactionRevision(): number {
    return this.compactions;
  }

  /**
   * Every pass's instance buffer, keyed by pass name.
   *
   * @returns The buffers.
   */
  get instanceBuffers(): ReadonlyMap<string, InstanceBuffer> {
    return this.buffersByName;
  }

  /**
   * The number of objects the scene mirrors, drawn or not.
   *
   * @returns The count.
   */
  get objectCount(): number {
    return this.hierarchy.size;
  }

  /**
   * The clipping frames' records every scene record's clip index names, which the
   * renderer uploads (`ClipTableTexture`).
   *
   * @returns The table.
   */
  get clipTable(): ClipTable {
    return this.tails.clips.table;
  }

  /**
   * One pass's instance buffer.
   *
   * @param passName - The pass's name.
   * @returns Its buffer.
   * @throws {RangeError} When no pass has that name.
   */
  instanceBufferOf(passName: string): InstanceBuffer {
    const buffer = this.buffersByName.get(passName);
    if (!buffer) throw new RangeError(`The scene has no pass named "${passName}".`);
    return buffer;
  }

  /**
   * The slots an object's records occupy in one pass's buffer.
   *
   * @param id - The object id.
   * @param passName - The pass's name.
   * @returns The slots, record 0 first; empty when the object has none there.
   * @throws {RangeError} When no pass has that name.
   */
  slotsOf(id: ObjectId, passName: string): readonly number[] {
    return this.stateOf(passName).slotsById.get(id) ?? [];
  }

  /**
   * Every object holding records in one pass, with its slots (record 0 first): what the z-order
   * segments map slots back to objects from, in time proportional to what the pass draws.
   *
   * @param passName - The pass's name.
   * @returns The objects and their slots; live, so read it before the scene changes again.
   * @throws {RangeError} When no pass has that name.
   */
  slotEntriesOf(passName: string): ReadonlyMap<ObjectId, readonly number[]> {
    return this.stateOf(passName).slotsById;
  }

  /**
   * Identifies exact slot ownership within this scene; record-only writes keep the revision.
   * Released ownership is zero, and recreated ownership always gets a fresh revision.
   *
   * @param id - The object.
   * @param passName - The pass.
   * @returns Its ownership revision, or zero when it owns no slots.
   * @throws {RangeError} When the pass does not exist.
   */
  slotRevisionOf(id: ObjectId, passName: string): number {
    return this.stateOf(passName).slotRevisions.get(id) ?? 0;
  }

  /**
   * Changes whenever any pass allocates or releases object slots, including deletion.
   * Equal revisions in this scene prove ownership is unchanged, not record contents.
   *
   * @returns The scene-wide ownership revision.
   */
  get slotOwnershipRevision(): number {
    return this.slotRevision;
  }

  /**
   * A paged pass's page per slot (`ScenePass.pageOf`): the table the draw list is split by. Live:
   * read it again after the scene changes; slots past the buffer's record count are 0.
   *
   * @param passName - The pass's name.
   * @returns The table, or `undefined` for a pass that is not paged.
   * @throws {RangeError} When no pass has that name.
   */
  pagesOf(passName: string): Int32Array | undefined {
    const state = this.stateOf(passName);
    return state.pass.pageOf === undefined ? undefined : state.pageBySlot;
  }

  /**
   * How many times a paged pass's page table has changed: equal revisions, equal tables.
   *
   * @param passName - The pass's name.
   * @returns The revision; 0 for a pass that is not paged.
   * @throws {RangeError} When no pass has that name.
   */
  pageRevisionOf(passName: string): number {
    return this.stateOf(passName).pageRevision;
  }

  /**
   * Rewrites one pass's records of objects whose document state did not change but whose
   * drawing did: a layout or a glyph landed, a texture level arrived (the previous
   * layout drew until the new one landed). Each target must be the object and
   * transform the scene last applied, and its record count in the pass must be unchanged, since
   * slots are not reallocated here. Only records whose values change are marked dirty.
   *
   * @param passName - The pass's name.
   * @param targets - The objects to rewrite, as last applied.
   * @returns How many records changed.
   * @throws {RangeError} When no pass has that name, or a target's record count changed.
   */
  rewriteRecords(passName: string, targets: Iterable<SceneObject>): number {
    const state = this.stateOf(passName);
    let changed = 0;
    for (const target of targets) {
      const slots = state.slotsById.get(target.object.id) ?? [];
      if (state.pass.recordCount(target.object) !== slots.length) {
        throw new RangeError(
          `Object "${target.object.id}" changed its record count in "${passName}"; apply it as a change instead.`,
        );
      }
      changed += this.writeRecords(state, target, slots);
    }
    return changed;
  }

  /**
   * What `'ink'` draws as in the viewer's theme.
   *
   * @returns The colour.
   */
  get ink(): Rgba {
    return this.colors.ink;
  }

  /**
   * Changes what `'ink'` draws as in the viewer's theme ({@link Scene.setTheme}'s rewrite).
   *
   * @param color - The new ink colour.
   * @returns How many records changed.
   */
  setInk(color: Rgba): number {
    return this.rewriteColors(this.colors.setInk(color));
  }

  /**
   * Switches the viewer's theme (and ink colours), rewriting only the records of objects naming
   * `'ink'` or a token whose colours change, from the targets last applied: no document read,
   * text layout or path mesh.
   *
   * @param theme - The viewer's theme.
   * @param inkColors - What ink draws as per theme; default the current ones.
   * @returns How many records changed.
   */
  setTheme(theme: ColorMode, inkColors?: InkColors): number {
    return this.rewriteColors(this.colors.setTheme(theme, inkColors));
  }

  /**
   * Replaces the board's colour token values, rewriting as {@link Scene.setTheme} does
   * the records of objects naming a token whose value changed in either mode.
   *
   * @param table - Each custom token and edited built-in by id, with its light and dark values.
   * @returns How many records changed.
   */
  setTokens(table: ColorTokenValues): number {
    return this.rewriteColors(this.colors.setTokens(table));
  }

  private rewriteColors(targets: readonly SceneObject[]): number {
    return rewriteTargets(this.states, targets, (...write) => this.writeRecords(...write));
  }

  /**
   * Brings the scene up to date with a document change. Every listed id is read through
   * `changes.get`: present, its records are rewritten (allocated or released as its record
   * counts change); absent, its records are released. Then the descendants of every changed
   * object are rewritten, since their world transforms depend on it. Only records whose values
   * change are marked dirty. A scoped host-owned root move uses its preflighted objects directly,
   * preserving retained callbacks without rewriting unchanged parent links.
   *
   * @param changes - The change set; its objects are read, never mutated.
   * @returns How many objects were rewritten or removed, descendants included.
   */
  apply(changes: SceneChangeSet): number {
    this.tails.beginApply();
    const objects = getRootMoveBatch(changes);
    if (objects && this.retainedMove && canApplyRootMove(changes, objects, this.hierarchy)) {
      for (const object of objects) this.tails.clips.noteFrame(object.id, object);
      for (const object of objects) this.upsert(object, changes, true);
      return objects.length;
    }
    const touched = new Set([...changes.created, ...changes.updated, ...changes.deleted]);
    // Clipping frames are all known before any record is written, whatever the set's order.
    for (const id of touched) this.tails.clips.noteFrame(id, changes.get(id));
    const visited = new Set<ObjectId>();
    for (const id of touched) this.refresh(id, changes, visited);
    const refresh = (id: ObjectId): boolean => this.refresh(id, changes, visited);
    if (this.hierarchy.hasParents)
      for (const id of touched) this.hierarchy.visitDescendants(id, visited, refresh);
    return visited.size;
  }

  // Rewrites or releases an object's records; true while the source still has it.
  private refresh(id: ObjectId, source: SceneSource, visited: Set<ObjectId>): boolean {
    visited.add(id);
    const object = source.get(id);
    if (object) this.upsert(object, source);
    else this.remove(id);
    return object !== undefined;
  }

  private stateOf(passName: string): PassState {
    // A loop, not `find`: no closure per call, read per pass per changed object.
    for (const state of this.states) if (state.pass.name === passName) return state;
    throw new RangeError(`The scene has no pass named "${passName}".`);
  }

  private upsert(object: BoardObject, source: SceneSource, isParentUnchanged = false): void {
    if (!isParentUnchanged) this.hierarchy.setParent(object.id, object.parentId);
    this.tails.update(object, source);
    const target = this.colors.targetOf(object, worldTransformOf(object, source), source);
    // A retained move's targets are restored by an ordinary apply when its session stops.
    if (this.retainedMove?.(target)) return;
    this.targets.set(object.id, target);
    upsertRecords(this.records, this.states, target);
  }

  /**
   * Prepares an object's records into its slots, with its palette, clip index and opacity.
   *
   * @param state - The pass.
   * @param target - The object and its world transform.
   * @param slots - Its slots, record 0 first.
   * @returns How many records changed.
   */
  private writeRecords(state: PassState, target: SceneObject, slots: readonly number[]): number {
    const painted = this.colors.current(target);
    return writeSlotRecords(state, painted, slots, this.tails);
  }

  private remove(id: ObjectId): void {
    if (!this.hierarchy.has(id)) return;
    removeRecords(this.records, this.states, id);
    this.hierarchy.remove(id);
    this.targets.delete(id);
    this.colors.forget(id);
    this.tails.remove(id);
  }
}
