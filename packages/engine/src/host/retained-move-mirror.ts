import type { BoardObject, ObjectId } from '@canvas/schema';

import type { RetainedMoveCommand } from './retained-move-command.js';
import { rootPositionClone } from './root-position-clone.js';

/**
 * The current immutable placement snapshot, with stable ordered base objects: each root at
 * `positions` plus `delta` when the last update was a translation (`positions` are then
 * the begin positions, the same array every translation frame), else at `positions`.
 */
export interface RetainedMoveSnapshot {
  readonly ids: readonly ObjectId[];
  readonly objects: readonly BoardObject[];
  readonly positions: Float64Array;
  readonly delta?: readonly [number, number];
}

interface MoveMember {
  readonly index: number;
  readonly clone: (x: number, y: number) => BoardObject;
  sequence: number;
  object: BoardObject | undefined;
}

/** Validates session order and lazily supplies ordinary objects for exact fallback and reads. */
export class RetainedMoveMirror {
  private session = 0;
  private sequence = -1;
  private snapshot: RetainedMoveSnapshot | undefined;
  /** The begin command's positions, which a translation is from. */
  private begin: Float64Array = new Float64Array(0);
  private readonly members = new Map<ObjectId, MoveMember>();

  /**
   * The currently retained membership and absolute positions.
   *
   * @returns The current snapshot, if any.
   */
  get current(): RetainedMoveSnapshot | undefined {
    return this.snapshot;
  }

  /**
   * Applies a validated wire command atomically; stale sequences and wrong lengths do nothing.
   * End is handled by the owner, which first persists the current objects for ordinary reads.
   *
   * @param command - A structurally validated command.
   * @returns Whether its session order and membership length are current.
   */
  accepts(command: RetainedMoveCommand): boolean {
    if (command.kind === 'begin') return command.session > this.session;
    return (
      this.snapshot !== undefined &&
      command.session === this.session &&
      command.sequence > this.sequence &&
      (command.kind === 'end' ||
        'delta' in command ||
        command.positions.length === this.snapshot.positions.length)
    );
  }

  /**
   * Installs an accepted begin/update, without cloning every base object.
   *
   * @param command - The command, already checked with accepts.
   */
  apply(command: RetainedMoveCommand): void {
    this.session = command.session;
    this.sequence = command.sequence;
    if (command.kind === 'end') {
      this.clear();
      return;
    }
    if (command.kind === 'begin') {
      this.members.clear();
      const ids = command.objects.map((object, index) => {
        this.members.set(object.id, {
          index,
          clone: rootPositionClone(object),
          sequence: -1,
          object: undefined,
        });
        return object.id;
      });
      this.begin = command.positions;
      this.snapshot = { ids, objects: command.objects, positions: command.positions };
    } else if (this.snapshot) {
      const { ids, objects } = this.snapshot;
      this.snapshot =
        'delta' in command
          ? { ids, objects, positions: this.begin, delta: command.delta }
          : { ids, objects, positions: command.positions };
    }
  }

  /** Ends retention while preserving the last session number against delayed commands. */
  clear(): void {
    this.snapshot = undefined;
    this.begin = new Float64Array(0);
    this.members.clear();
  }

  /**
   * Reads one exact object, allocating at most once per received position snapshot.
   *
   * @param id - The member id.
   * @returns The preview object, or undefined outside retained membership.
   */
  get(id: ObjectId): BoardObject | undefined {
    if (this.snapshot === undefined) return undefined;
    const member = this.members.get(id);
    if (member === undefined) return undefined;
    if (member.sequence === this.sequence) return member.object;
    const { index } = member;
    const { objects, positions, delta } = this.snapshot;
    const base = objects[index];
    const x = positions[index * 2];
    const y = positions[index * 2 + 1];
    if (base === undefined || x === undefined || y === undefined) return undefined;
    const object = delta ? member.clone(x + delta[0], y + delta[1]) : member.clone(x, y);
    member.object = object;
    member.sequence = this.sequence;
    return object;
  }
}
