import type { BoardObject, ObjectId } from '@canvas/schema';

import { markRootMoveChanges } from '../scene/root-move-changes.js';
import { markRootMovePlacement } from '../scene/root-move-placement.js';
import { SceneChangeQueue } from '../scene/scene-change-queue.js';
import type { SceneChangeSet, SceneSource } from '../scene/scene-source.js';

import type { RetainedMoveCommand } from './retained-move-command.js';
import { RetainedMoveMirror, type RetainedMoveSnapshot } from './retained-move-mirror.js';
import type { SerializableChangeSet } from './serializable-change-set.js';

interface PendingPosition {
  readonly object: BoardObject;
  x: number;
  y: number;
}

/**
 * The engine worker's copy of the document: a map of the objects the main thread has sent in
 * {@link SerializableChangeSet}s, read by the scene as its {@link SceneSource}. The
 * worker cannot call back into the main thread's document, so the scene reads this mirror instead.
 * Lives on the thread that renders; it holds the objects it receives and never mutates them.
 */
export class SceneSourceMirror implements SceneSource {
  private readonly objects = new Map<ObjectId, BoardObject>();
  private readonly move = new RetainedMoveMirror();

  /**
   * Creates a mirror. Only the worker entry may claim exclusive ownership of received buffers.
   *
   * @param hasExclusiveRetainedPositions - Whether received placement arrays belong to this worker.
   */
  constructor(private readonly hasExclusiveRetainedPositions = false) {}

  /**
   * Current transient placement, read by the renderer's retained path.
   *
   * @returns Current retained placement, if any.
   */
  get retainedMove(): RetainedMoveSnapshot | undefined {
    return this.move.current;
  }

  /**
   * Applies an ordered placement command. Rejects stale or inconsistent messages atomically.
   *
   * @param command - The structurally validated host command.
   * @returns A normal change set for exact fallback, or undefined for an obsolete command.
   */
  applyMove(command: RetainedMoveCommand): SceneChangeSet | undefined {
    if (!this.move.accepts(command)) return undefined;
    const previous = this.move.current?.ids ?? [];
    if (command.kind !== 'update') this.materializeMove();
    this.move.apply(command);
    if (command.kind === 'begin')
      for (const object of command.objects) this.objects.set(object.id, object);
    const changes: SceneChangeSet = {
      created: [],
      updated: this.move.current?.ids ?? previous,
      deleted: [],
      get: (id) => this.get(id),
    };
    if (command.kind !== 'update') return changes;
    markRootMoveChanges(changes);
    const positions = 'delta' in command ? this.move.current?.positions : command.positions;
    if (!this.hasExclusiveRetainedPositions || !(positions?.buffer instanceof ArrayBuffer))
      return changes;
    return markRootMovePlacement(changes, () => {
      const current = this.move.current;
      return current?.positions.buffer instanceof ArrayBuffer ? current : undefined;
    });
  }

  /** Persists the shown positions before ordinary edits, replay or ending a session. */
  materializeMove(): void {
    for (const id of this.move.current?.ids ?? []) {
      const object = this.move.get(id);
      if (object) this.objects.set(id, object);
    }
    this.move.clear();
  }

  /**
   * The number of objects mirrored.
   *
   * @returns The count.
   */
  get size(): number {
    return this.objects.size;
  }

  /**
   * Reads a mirrored object.
   *
   * @param id - The object id.
   * @returns The object as last received, or `undefined` when the mirror has none.
   */
  get(id: ObjectId): BoardObject | undefined {
    return this.move.get(id) ?? this.objects.get(id);
  }

  /**
   * The whole mirror as one change set that creates every object: what a rebuilt renderer is
   * given after a device loss.
   *
   * @returns The change set, reading this mirror.
   */
  everything(): SceneChangeSet {
    return {
      created: [...this.objects.keys()],
      updated: [],
      deleted: [],
      get: (id) => this.get(id),
    };
  }

  /**
   * Brings the mirror up to date with one change: every listed id takes its state from
   * `changes.objects` (present: stored; absent: removed), and every other object there, an
   * ancestor sent for its world transform, is stored too.
   *
   * @param changes - The change as received from the main thread.
   * @returns The same change as a {@link SceneChangeSet} that reads this mirror, for
   *   `SceneRenderer.enqueue`.
   */
  apply(changes: SerializableChangeSet): SceneChangeSet {
    if (this.touchesMove(changes)) this.materializeMove();
    const positions = new Map<ObjectId, PendingPosition>();
    const result = this.applyInto(changes, positions);
    this.flushPositions(positions);
    return result;
  }

  /**
   * Applies queued changes in order, cloning each translated object only at its final position.
   * Every addition is still evaluated sequentially: summing deltas would change float rounding.
   * Full-object replacements and deletion discard any preceding deferred position.
   *
   * @param changes - Validated changes in delivery order.
   * @returns Their final-state change set, or undefined when the queue is empty.
   */
  applyBatch(changes: readonly SerializableChangeSet[]): SceneChangeSet | undefined {
    if (changes.length === 0) return undefined;
    if (changes.some((change) => this.touchesMove(change))) this.materializeMove();
    const positions = new Map<ObjectId, PendingPosition>();
    const queue = new SceneChangeQueue();
    for (const change of changes) queue.push(this.applyInto(change, positions));
    this.flushPositions(positions);
    return queue.drain();
  }

  /**
   * Whether a change reaches a retained session's members, which must then hold their shown
   * positions first; a session survives changes to other objects.
   *
   * @param changes - The change as received.
   * @returns True when it lists, translates or carries a member.
   */
  private touchesMove(changes: SerializableChangeSet): boolean {
    const ids = this.move.current?.ids;
    if (ids === undefined) return false;
    const members = new Set(ids);
    const { created, updated, deleted, objects, translation } = changes;
    return (
      [created, updated, deleted, translation?.ids ?? []].some((listed) =>
        listed.some((id) => members.has(id)),
      ) || Object.keys(objects).some((id) => members.has(id as ObjectId))
    );
  }

  private flushPositions(positions: ReadonlyMap<ObjectId, PendingPosition>): void {
    for (const [id, { object, x, y }] of positions) this.objects.set(id, { ...object, x, y });
  }

  private applyInto(
    changes: SerializableChangeSet,
    positions: Map<ObjectId, PendingPosition>,
  ): SceneChangeSet {
    const { objects, translation } = changes;
    const translated = new Set(translation?.ids);
    if (translation !== undefined) {
      for (const id of translated) {
        let position = positions.get(id);
        if (position === undefined) {
          const object = this.objects.get(id);
          if (object === undefined) continue;
          position = { object, x: object.x, y: object.y };
          positions.set(id, position);
        }
        position.x += translation.x;
        position.y += translation.y;
      }
    }
    for (const id of [...changes.created, ...changes.updated, ...changes.deleted]) {
      const object = Object.hasOwn(objects, id) ? objects[id] : undefined;
      if (object === undefined) {
        if (!translated.has(id)) {
          positions.delete(id);
          this.objects.delete(id);
        }
      } else {
        positions.delete(id);
        this.objects.set(id, object);
      }
    }
    for (const [id, object] of Object.entries(objects)) {
      positions.delete(id as ObjectId);
      this.objects.set(id as ObjectId, object);
    }
    return {
      created: changes.created,
      updated: changes.updated,
      deleted: changes.deleted,
      get: (id) => this.get(id),
    };
  }
}
