import type { ObjectId } from '@canvas/schema';

import { isRootMoveChanges } from '../scene/root-move-changes.js';
import { getRootMovePlacement } from '../scene/root-move-placement.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import {
  MAX_REPORTED_UNDRAWABLE,
  type UndrawableObject,
  type UndrawableReason,
  type UndrawableReport,
} from './drawable-extent.js';
import { fixedFieldsReason } from './drawable-fields.js';
import { rootMoveReason, undrawableReasonIn, type DrawableMemo } from './drawable-geometry.js';
import { emptyHull, extendHull, isHullWithin, type SubtreeHull } from './drawable-hull.js';
import { BOARD, placeInto } from './drawable-placement.js';
import { matchesRootPlacement, RootMoveEnvelope } from './root-move-envelope.js';

/** One `filter` call's state. */
interface GatePass {
  readonly changes: SceneChangeSet;
  readonly isRootMove: boolean;
  /** The ids the change set lists. */
  readonly listed: ReadonlySet<ObjectId>;
  /** Judgements of frames and groups made in this pass. */
  readonly memo: DrawableMemo;
  /** Objects whose drawability flipped with an ancestor, for readers to re-read. */
  flipped: ObjectId[] | undefined;
}

/**
 * The door every document change set passes before the scene reads it: it judges each
 * changed object, and each descendant of one, with `undrawableReasonOf`, and hands on a change
 * set in which an undrawable object is absent (its `get` returns `undefined`). So the scene, its
 * passes (shapes, images, paths, text), the level of detail, the culler's index and the z-order
 * segments all treat it as deleted, from one check made when it changes and never per frame. The
 * document keeps it: the gate repairs and removes nothing, so it can still be selected by id and
 * deleted.
 *
 * An object whose drawability changes because an ancestor changed (a frame moved to NaN, then
 * back) is added to the change set's `updated` ids, so every reader re-reads it. The cost is
 * O(changed objects) per change set: a changed frame's descendants are walked only when its
 * subtree may have changed with it; a frame that moves or turns while no descendant changed is
 * answered by its kept subtree hull (fix round 2: a select-all drag previews every frame each
 * frame). An honest change
 * set is handed on as it is. Each undrawable object is reported once per change that touches it
 * or its ancestors' drawability, through {@link DrawableGate.takeReport}. On the thread that
 * renders, owned by the `SceneRenderer`.
 */
export class DrawableGate {
  private envelope: RootMoveEnvelope | undefined;
  /** Every object held undrawable now, with its reason. */
  private readonly reasons = new Map<ObjectId, UndrawableReason>();
  /** Every changed object's parent, so a parent's change finds its descendants. */
  private readonly parentById = new Map<ObjectId, ObjectId | null>();
  private readonly childrenByParent = new Map<ObjectId, Set<ObjectId>>();
  /**
   * Each frame or group's subtree hull, in its own frame, while every descendant is drawable and
   * none changed since it was walked (`isSubtreeKept`).
   */
  private readonly hulls = new Map<ObjectId, SubtreeHull>();
  /** Reports not taken yet, one per object (the latest reason). */
  private readonly pending = new Map<ObjectId, UndrawableReason>();
  /** Unchanged field verdicts, retained only across proven root-leaf x/y updates. */
  private readonly fixedReasons = new Map<ObjectId, UndrawableReason | undefined>();

  /**
   * The number of objects held undrawable.
   *
   * @returns The count.
   */
  get undrawableCount(): number {
    return this.reasons.size;
  }

  /**
   * Whether an object may be drawn: false only for an object the gate holds undrawable.
   *
   * @param id - The object's id.
   * @returns True unless the last change set that touched it left it undrawable.
   */
  isDrawable(id: ObjectId): boolean {
    return !this.reasons.has(id);
  }

  /**
   * Judges a change set and hands on what the scene may read of it.
   *
   * @param changes - The change set, as the document produced it; read, never mutated.
   * @returns The same change set when it leaves nothing undrawable and changes nobody's
   *   drawability; otherwise one listing the objects whose drawability changed as updated, whose
   *   `get` hides every undrawable object.
   */
  filter(changes: SceneChangeSet): SceneChangeSet {
    const current = getRootMovePlacement(changes);
    const placement = current && matchesRootPlacement(changes, current) ? current : undefined;
    if (
      placement &&
      isRootMoveChanges(changes) &&
      this.reasons.size === 0 &&
      this.envelope?.accepts(placement)
    )
      return changes;
    this.envelope = undefined;
    const listed = new Set<ObjectId>();
    for (const ids of [changes.created, changes.updated, changes.deleted]) {
      for (const id of ids) listed.add(id);
    }
    const isRootMove = this.isRootLeafMove(changes);
    if (!isRootMove)
      for (const id of listed) {
        this.fixedReasons.delete(id);
        // The hulls holding it before and after a move between parents no longer hold.
        this.forgetHullsAbove(id);
        this.setParent(id, changes.get(id)?.parentId);
        this.forgetHullsAbove(id);
      }
    const pass: GatePass = { changes, listed, memo: new Map(), flipped: undefined, isRootMove };
    for (const id of listed) this.judge(id, pass, true);
    // Each changed frame or group whose subtree may have changed with it, once: not one inside
    // another changed one, whose walk covers it, and not one whose subtree provably stays put.
    if (!isRootMove)
      for (const id of listed) {
        if (!this.childrenByParent.has(id) || this.hasListedAncestor(id, listed)) continue;
        if (!this.isSubtreeKept(id, pass.memo)) this.walkSubtree(id, pass);
      }
    if (placement && isRootMove && this.reasons.size === 0)
      this.envelope = RootMoveEnvelope.create(placement);
    const { flipped } = pass;
    if (this.reasons.size === 0 && flipped === undefined) return changes;
    return {
      created: changes.created,
      updated: flipped === undefined ? changes.updated : [...changes.updated, ...flipped],
      deleted: changes.deleted,
      get: (id) => (this.reasons.has(id) ? undefined : changes.get(id)),
    };
  }

  /**
   * Admits only known root leaves with no actual children; malformed parent links fall back.
   *
   * @param changes - The engine-owned update.
   * @returns Whether parent and subtree bookkeeping is provably unchanged for every member.
   */
  private isRootLeafMove(changes: SceneChangeSet): boolean {
    return (
      isRootMoveChanges(changes) &&
      changes.created.length === 0 &&
      changes.deleted.length === 0 &&
      changes.updated.every((id) => {
        const object = changes.get(id);
        return (
          this.parentById.get(id) === null &&
          object?.parentId === null &&
          object.type !== 'frame' &&
          object.type !== 'group' &&
          !this.childrenByParent.has(id)
        );
      })
    );
  }

  /**
   * Whether a changed frame or group carries its whole subtree with it unchanged and drawable:
   * it is drawable, every descendant was when last walked and none changed since (its hull is
   * kept), and the hull at its new placement lies within the extent. O(1): a preview frame of a
   * select-all drag re-judges the moved frames, never their descendants.
   *
   * @param id - The frame or group.
   * @param memo - The pass's judgements, holding its own.
   * @returns True when nothing below it needs judging.
   */
  private isSubtreeKept(id: ObjectId, memo: DrawableMemo): boolean {
    const hull = this.hulls.get(id);
    const judged = memo.get(id);
    if (hull === undefined || judged === undefined || judged.reason !== undefined) return false;
    return isHullWithin(hull, judged.placement);
  }

  /**
   * Judges every descendant of a changed frame or group (those the change set lists are judged
   * already) and keeps the subtree's hull when all of them are drawable.
   *
   * @param root - The frame or group.
   * @param pass - The pass.
   */
  private walkSubtree(root: ObjectId, pass: GatePass): void {
    const rootJudged = pass.memo.get(root);
    const frame = rootJudged?.reason === undefined ? rootJudged?.placement : undefined;
    let hull = frame === undefined ? undefined : emptyHull();
    const visited = new Set<ObjectId>([root]);
    const pending = [...(this.childrenByParent.get(root) ?? [])];
    // Breadth first (an array's iterator reads what is pushed during it): a parent is judged
    // before its children, which read its judgement.
    for (const id of pending) {
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...(this.childrenByParent.get(id) ?? []));
      if (!pass.listed.has(id)) this.judge(id, pass, false);
      if (hull === undefined || frame === undefined) continue;
      const object = pass.changes.get(id);
      const parent = object?.parentId == null ? undefined : pass.memo.get(object.parentId);
      if (object === undefined || this.reasons.has(id) || parent === undefined) {
        hull = undefined;
        continue;
      }
      extendHull(hull, frame, object, placeInto({ ...BOARD }, parent.placement, object));
    }
    if (hull === undefined) this.hulls.delete(root);
    else this.hulls.set(root, hull);
  }

  /**
   * Whether an ancestor of an object is listed too, so the ancestor's walk covers it.
   *
   * @param id - The object.
   * @param listed - The listed ids.
   * @returns True when one is.
   */
  private hasListedAncestor(id: ObjectId, listed: ReadonlySet<ObjectId>): boolean {
    const visited = new Set<ObjectId>([id]);
    for (let parent = this.parentById.get(id) ?? null; parent !== null;) {
      if (listed.has(parent)) return true;
      if (visited.has(parent)) return false;
      visited.add(parent);
      parent = this.parentById.get(parent) ?? null;
    }
    return false;
  }

  /**
   * Forgets the hull of every frame or group above an object, whose subtree it changes.
   *
   * @param id - The object.
   */
  private forgetHullsAbove(id: ObjectId): void {
    const visited = new Set<ObjectId>([id]);
    for (let parent = this.parentById.get(id) ?? null; parent !== null;) {
      if (visited.has(parent)) return;
      visited.add(parent);
      this.hulls.delete(parent);
      parent = this.parentById.get(parent) ?? null;
    }
  }

  /**
   * Judges one object of a change set, records its verdict and, when it is undrawable after a
   * change that concerns it, its report.
   *
   * An object whose drawability flipped without being listed is noted in the pass, so readers
   * re-read it.
   *
   * @param id - The object.
   * @param pass - The pass: the change set, its listed ids, the judgements so far.
   * @param isListed - Whether the change set lists it (else a descendant of a listed object).
   */
  private judge(id: ObjectId, pass: GatePass, isListed: boolean): void {
    const object = pass.changes.get(id);
    let reason: UndrawableReason | undefined;
    if (object && pass.isRootMove) {
      if (!this.fixedReasons.has(id)) this.fixedReasons.set(id, fixedFieldsReason(object));
      reason = rootMoveReason(object, this.fixedReasons.get(id));
    } else reason = object && undrawableReasonIn(object, pass.changes, pass.memo);
    const previous = this.reasons.get(id);
    if (reason === undefined) {
      this.pending.delete(id);
      if (this.reasons.delete(id) && !isListed) (pass.flipped ??= []).push(id);
      return;
    }
    this.reasons.set(id, reason);
    // An undrawable frame or group keeps no hull: its subtree is walked when it mends.
    this.hulls.delete(id);
    if (isListed || previous !== reason) this.pending.set(id, reason);
    if (previous === undefined && !isListed) (pass.flipped ??= []).push(id);
  }

  /**
   * Takes the undrawable objects found since the last call, each once, in the order found: the
   * first `MAX_REPORTED_UNDRAWABLE` listed, and how many there were.
   *
   * @returns The report; an empty list and a count of 0 when none was found.
   */
  takeReport(): UndrawableReport {
    const objects: UndrawableObject[] = [];
    for (const [id, reason] of this.pending) {
      if (objects.length === MAX_REPORTED_UNDRAWABLE) break;
      objects.push({ id, reason });
    }
    const count = this.pending.size;
    this.pending.clear();
    return { objects, count };
  }

  /**
   * Records an object's parent, or forgets the object when it is gone; a gone object's children
   * stay listed under it, so a later change to it (a parent restored) still finds them.
   *
   * @param id - The object id.
   * @param parentId - Its parent now, null at the root, or `undefined` when it was deleted.
   */
  private setParent(id: ObjectId, parentId: ObjectId | null | undefined): void {
    const previous = this.parentById.get(id) ?? null;
    if (parentId === undefined) this.parentById.delete(id);
    else this.parentById.set(id, parentId);
    const next = parentId ?? null;
    if (previous === next) return;
    if (previous !== null) {
      const siblings = this.childrenByParent.get(previous);
      siblings?.delete(id);
      if (siblings?.size === 0) this.childrenByParent.delete(previous);
    }
    if (next !== null) {
      const siblings = this.childrenByParent.get(next) ?? new Set();
      siblings.add(id);
      this.childrenByParent.set(next, siblings);
    }
  }
}
