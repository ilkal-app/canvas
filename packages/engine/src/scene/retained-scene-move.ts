import type { ObjectId } from '@canvas/schema';

import type { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { matchesRootPlacement } from '../drawable/root-move-envelope.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import { TransformTable, type TransformTablePlacement } from '../gpu/transform-table.js';

import type { FrameStats } from './frame-context.js';
import { RetainedMembers, type RetainedMemberChecks } from './retained-members.js';
import {
  followersOf,
  followTranslation,
  isSamePositions,
  translatedPositions,
  type TranslationFollowers,
} from './retained-translation.js';
import { getRootMovePlacement } from './root-move-placement.js';
import type { ScenePassResources } from './scene-pass-resources.js';
import type { SceneObject, ScenePass } from './scene-pass.js';
import type { SceneChangeSet, SceneSource } from './scene-source.js';
import type { Scene } from './scene.js';
import { worldTransformOf } from './world-transform.js';

interface MovedObject {
  readonly index: number;
  readonly extras: readonly { readonly pass: ScenePass; readonly indices: readonly number[] }[];
}

/**
 * What a retained move places root leaves through without a change set: the
 * culler's moving set, and what keeps a session on the change-set path.
 */
export interface RetainedPlacementHooks extends RetainedMemberChecks {
  /** The spatial culler's moving set; without one, every update is a change set. */
  readonly culler?: {
    beginRetained(ids: readonly ObjectId[], positions: Float64Array): void;
    moveRetained(positions: Float64Array): void;
    /** Moves every member by one translation from where `moveRetained` last put them. */
    translateRetained(dx: number, dy: number): void;
    endRetained(): void;
  };
}

/**
 * One root-leaf placement session. Its first frame prepares ordinary records; only then are
 * stable slots indexed. Later updates preserve all ordinary culling/order change notifications.
 */
export class RetainedSceneMove {
  private ids: readonly ObjectId[] | undefined;
  private source: SceneSource | undefined;
  private table: TransformTable | undefined;
  private readonly indices: GpuBuffer[] = [];
  private readonly objects = new Map<ObjectId, MovedObject>();
  private pendingBytes = 0;
  private pendingWrites = 0;
  private hooks: RetainedPlacementHooks | undefined;
  /** Set while updates bypass change sets: every object placed, roots first. */
  private placed: RetainedMembers | undefined;
  private current: (target: SceneObject) => SceneObject = (target) => target;
  /**
   * The root positions the table and the culler hold the members at while a translation moves
   * them: the session's begin positions, once a translating update placed them.
   */
  private base: Float64Array | undefined;
  /** The root positions the members were last placed at, `x, y` per root. */
  private held: Float64Array | undefined;
  /** The translation the table's offset holds from `base`. */
  private delta: readonly [number, number] | undefined;
  /** The passes that follow translated targets, and the members that have records in them. */
  private followers: TranslationFollowers | undefined;

  constructor(
    private readonly backend: GpuBackend,
    private readonly scene: Scene,
    private readonly passes: readonly ScenePassResources[],
    private readonly ledger?: MemoryLedger,
  ) {}

  /**
   * Lets updates bypass change sets: placed straight into the transform table, the
   * passes' retained targets and the culler's moving set.
   *
   * @param hooks - The culler and the checks that keep a session on the change-set path.
   */
  usePlacementHooks(hooks: RetainedPlacementHooks): void {
    this.hooks = hooks;
  }

  /**
   * Whether a session is placing its members without change sets.
   *
   * @param ids - The membership, the session's or an equal list.
   * @returns True when `place` may be given this membership's placements.
   */
  isPlacing(ids: readonly ObjectId[]): boolean {
    const own = this.ids;
    return (
      this.placed !== undefined &&
      this.table !== undefined &&
      own !== undefined &&
      (own === ids || (own.length === ids.length && own.every((id, index) => id === ids[index])))
    );
  }

  /**
   * Places a trusted update without a change set: no scene apply, z-order observation, routing
   * or object clone. Refuses an update without the host's placement provenance, of another
   * membership, or that the drawable envelope does not prove drawable; a refusal ends the bypass
   * for the rest of the session, since the caller sends the update as a change set, which
   * re-indexes the members.
   *
   * @param ids - The membership, the session's or an equal list.
   * @param changes - The update.
   * @returns True when placed.
   */
  placeOnly(ids: readonly ObjectId[], changes: SceneChangeSet): boolean {
    const { placed } = this;
    if (!placed) return false;
    const placement = getRootMovePlacement(changes);
    if (!placement || !matchesRootPlacement(changes, placement) || !this.isPlacing(ids)) {
      this.endPlacing();
      return false;
    }
    const { delta } = placement;
    // A translation is placed through the offset while it stays precise, else as positions.
    const isOffset = delta !== undefined && placed.acceptsDelta(placement.positions, delta);
    const positions =
      delta === undefined || isOffset
        ? placement.positions
        : translatedPositions(placement.positions, delta);
    if (!isOffset && !placed.accepts(positions)) {
      this.endPlacing();
      return false;
    }
    // The members already at the positions a translation is from: nothing to place first.
    if (isOffset && this.base !== positions && isSamePositions(this.held, positions)) {
      this.base = positions;
    }
    if (isOffset && this.base === positions) {
      // A translation of what the table holds: one texel and the culler's shared shift.
      this.table?.setOffset(delta[0], delta[1]);
      this.hooks?.culler?.translateRetained(delta[0], delta[1]);
      this.delta = delta;
      this.followers ??= followersOf(this.passes, this.scene, placed.ids);
      followTranslation(this.followers, placed, positions, delta, this.current);
      return true;
    }
    this.settleTranslation();
    // Every member placed at the positions (for a translation, at the positions it is from).
    this.table?.setOffset(0, 0);
    const at = placed.place(positions, (target) => this.place(this.current(target)));
    this.hooks?.culler?.moveRetained(at);
    this.held = positions;
    this.base = isOffset ? positions : undefined;
    return isOffset ? this.placeOnly(ids, changes) : true;
  }

  /**
   * Where a member draws now: its table placement moved by the session's translation, as the
   * move shaders read it; for tests and diagnostics.
   *
   * @param id - The member.
   * @returns Its placement, or undefined outside the session's table.
   */
  placementOf(id: ObjectId): TransformTablePlacement | undefined {
    const moved = this.objects.get(id);
    return moved && this.table?.read(moved.index);
  }

  /**
   * Requests the session, or supplies its latest source; every id must remain drawable.
   *
   * @param ids - Stable membership identity.
   * @param source - Current objects after the drawable gate.
   * @returns Previous membership that needs ordinary records before this replacement.
   */
  request(ids: readonly ObjectId[], source: SceneSource): SceneChangeSet | undefined {
    const isEligible = !ids.some((id) => source.get(id)?.parentId !== null);
    const shouldStop = !isEligible || this.ids !== ids;
    const restore = shouldStop ? this.restoration() : undefined;
    if (shouldStop) this.stop();
    if (isEligible) {
      this.ids = ids;
      this.source = source;
    }
    return restore;
  }

  /**
   * Activates only after ordinary records exist, then uploads compact placements before draw.
   *
   * @param stats - Frame upload counters.
   */
  upload(stats: FrameStats): void {
    if (!this.table && this.ids && this.source) this.start(this.ids, this.source);
    if (this.table) stats.uploadedBytes += this.table.flush().uploadedBytes;
    stats.uploadedBytes += this.pendingBytes;
    stats.bufferWrites += this.pendingWrites;
    this.pendingBytes = 0;
    this.pendingWrites = 0;
  }

  /**
   * Ends the overrides before an ordinary change set, as `restoration` and `stop` do. A session
   * the change set does not touch (it lists none of its members) is requested again, so it
   * resumes, re-indexed, on the next frame.
   *
   * @param changes - The ordinary change set about to be queued.
   * @returns The restoration to queue before it, if any.
   */
  interrupt(changes: SceneChangeSet): SceneChangeSet | undefined {
    const { ids, source, objects } = this;
    const lists = [changes.created, changes.updated, changes.deleted];
    const members = objects.size > 0 ? objects : new Set(ids);
    const isTouched = lists.some((listed) => listed.some((id) => members.has(id)));
    const restore = this.restoration();
    this.stop();
    if (ids === undefined || source === undefined || isTouched) return restore;
    this.ids = ids;
    this.source = source;
    return restore;
  }

  /**
   * The latest shown objects that need ordinary records before their shader override is removed.
   *
   * @returns The restoration change set, or undefined outside a retained session.
   */
  restoration(): SceneChangeSet | undefined {
    if (!this.ids || !this.source || !this.table) return undefined;
    const source = this.source;
    return { created: [], updated: this.ids, deleted: [], get: (id) => source.get(id) };
  }

  /** Disables every shader override before ordinary updates or releasing the session. */
  stop(): void {
    this.endPlacing();
    this.scene.useRetainedMove(undefined);
    if (this.table) for (const pass of this.passes) pass.setMovePlacement(undefined);
    for (const buffer of this.indices) buffer.destroy();
    this.indices.length = 0;
    this.table?.destroy();
    this.table = undefined;
    this.ids = undefined;
    this.source = undefined;
    this.objects.clear();
    this.ledger?.delete('textures', 'retained-move-table');
    this.ledger?.delete('instanceBuffers', 'retained-move-indices');
  }

  private start(ids: readonly ObjectId[], source: SceneSource): void {
    const culler = this.hooks?.culler;
    this.current = this.scene.useRetainedMove(undefined);
    const placed =
      this.hooks && culler
        ? RetainedMembers.expand(ids, this.scene.hierarchy, source, this.hooks, this.current)
        : undefined;
    // A group or frame root moves its subtree only by placement.
    const hasSubtrees = ids.some((id) => this.scene.hierarchy.childrenOf(id).size > 0);
    const members = hasSubtrees ? placed?.ids : ids;
    let count = members?.length ?? 0;
    if (!members || !this.canStart(ids, members, source, hasSubtrees)) {
      this.ids = undefined;
      return;
    }
    members.forEach((id, index) => {
      const extras = this.passes.flatMap(({ pass }) => {
        if (!pass.movePlacement) return [];
        return [{ pass, indices: this.scene.slotsOf(id, pass.name).map(() => ++count) }];
      });
      this.objects.set(id, { index: index + 1, extras });
    });
    const limit = this.backend.capabilities.maxTextureSize;
    if (count >= Math.min(limit * limit, 2 ** 24)) {
      this.objects.clear();
      this.ids = undefined;
      return;
    }
    this.table = new TransformTable(this.backend, count);
    for (const resource of this.passes) this.bind(resource, members);
    this.ledger?.set('textures', 'retained-move-table', this.table.byteLength);
    this.ledger?.set(
      'instanceBuffers',
      'retained-move-indices',
      this.indices.reduce((bytes, buffer) => bytes + buffer.byteLength, 0),
    );
    for (const id of members) {
      const object = source.get(id);
      if (object) this.place({ object, transform: worldTransformOf(object, source) });
    }
    this.current = this.scene.useRetainedMove((target) => this.place(target));
    if (placed && culler) {
      // Updates bypass change sets from now on: the culler keeps every member's box.
      this.placed = placed;
      const roots = new Float64Array(ids.length * 2);
      ids.forEach((id, index) => {
        const object = source.get(id);
        roots[index * 2] = object?.x ?? 0;
        roots[index * 2 + 1] = object?.y ?? 0;
      });
      culler.beginRetained(placed.ids, placed.place(roots, () => undefined).slice());
      this.held = roots;
    }
  }

  /**
   * Places every member where a translation left it, offset 0 again: before positions
   * place them, and before change sets or the end take over, so the passes' retained targets
   * (text bounds, image residency) and the table hold the members where they are.
   */
  private settleTranslation(): void {
    const { placed, base, delta } = this;
    this.delta = undefined;
    if (!placed || !base || !delta) return;
    const final = translatedPositions(base, delta);
    this.table?.setOffset(0, 0);
    this.hooks?.culler?.moveRetained(
      placed.place(final, (target) => this.place(this.current(target))),
    );
    this.held = final;
    this.base = undefined;
  }

  /** Ends the bypass: later updates, and the restoration, are change sets. */
  private endPlacing(): void {
    this.settleTranslation();
    if (this.placed) this.hooks?.culler?.endRetained();
    this.placed = undefined;
    this.base = undefined;
    this.held = undefined;
    this.followers = undefined;
  }

  private canStart(
    roots: readonly ObjectId[],
    members: readonly ObjectId[],
    source: SceneSource,
    hasSubtrees: boolean,
  ): boolean {
    return (
      roots.length > 0 &&
      roots.every(
        (id) => this.scene.hierarchy.has(id) && this.scene.hierarchy.parentOf(id) === null,
      ) &&
      (hasSubtrees || roots.every((id) => this.scene.hierarchy.isRootLeaf(id))) &&
      members.every((id) => {
        const object = source.get(id);
        if (!object) return false;
        return this.passes.every(({ pass, drawer }) => {
          const count = pass.recordCount(object);
          return (
            count === this.scene.slotsOf(id, pass.name).length &&
            ((count === 0 && pass.isRootMoveEmpty === true) ||
              (pass.pipelineSpec.moveShader !== undefined &&
                (drawer === undefined || drawer.setMovePlacement !== undefined)))
          );
        });
      })
    );
  }

  private bind(resource: ScenePassResources, ids: readonly ObjectId[]): void {
    const table = this.table;
    if (!table || !resource.pass.pipelineSpec.moveShader) return;
    const { pass, instances } = resource;
    const data = new Float32Array(instances.capacity);
    for (const id of ids) {
      const moved = this.objects.get(id);
      const extra = moved?.extras.find((entry) => entry.pass === pass);
      this.scene.slotsOf(id, pass.name).forEach((slot, record) => {
        data[slot] = extra?.indices[record] ?? moved?.index ?? 0;
      });
    }
    const buffer = this.backend.createBuffer({
      usage: 'vertex',
      byteLength: data.byteLength,
      label: `${pass.name} move indices`,
    });
    this.backend.writeBuffer(buffer, 0, data);
    this.pendingBytes += data.byteLength;
    this.pendingWrites++;
    this.indices.push(buffer);
    resource.setMovePlacement({ table, indices: buffer, indexData: data });
  }

  private place(target: SceneObject): boolean {
    const moved = this.objects.get(target.object.id);
    const table = this.table;
    if (!moved || !table) return false;
    table.set(moved.index, target.transform);
    for (const { pass, indices } of moved.extras)
      indices.forEach((index, record) => {
        const transform = pass.movePlacement?.(target, record);
        if (transform) table.set(index, transform);
      });
    for (const { pass } of this.passes) pass.retainMoveTarget?.(target);
    return true;
  }
}
