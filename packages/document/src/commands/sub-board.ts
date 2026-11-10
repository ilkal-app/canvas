import { namedSwapTargets, type Board, type BoardObject, type ObjectId } from '@canvas/schema';

import type { BoardReader } from './command.js';

/**
 * The part of the board one command reads, gathered object by object through `get` and the
 * reverse indexes, so that the schema's pure rules (`cascadeDelete`, `validateBoard`,
 * `localBounds`, the frame transforms), which take a whole `Board` and scan it, run on it in
 * time proportional to what the command touches rather than to the board (the
 * schema's rules are O(n) per call on a 50k-object board).
 *
 * The caller decides what the rule needs: an object's ancestors for its frame transform, a
 * subtree for a group's derived bounds or a cascading delete, connectors and comments by
 * target. Proposed objects (a new connector, a reparented child) can be laid over the board, so
 * the rules check the board as the command would leave it; the overlay affects lookups only,
 * never the reverse indexes that subtrees are walked by.
 */
export class SubBoard {
  readonly #reader: BoardReader;
  readonly #overlay: ReadonlyMap<ObjectId, BoardObject>;
  readonly #objects = new Map<ObjectId, BoardObject>();
  /** Objects whose whole chain of ancestors has been gathered. */
  readonly #withAncestors = new Set<ObjectId>();
  /** Objects whose whole subtree has been gathered. */
  readonly #withSubtree = new Set<ObjectId>();

  /**
   * Starts an empty sub-board.
   *
   * @param reader - The board to gather from.
   * @param overlay - Proposed objects, keyed by id, that replace or add to the board's.
   */
  constructor(reader: BoardReader, overlay: Iterable<BoardObject> = []) {
    this.#reader = reader;
    this.#overlay = new Map([...overlay].map((object) => [object.id, object]));
  }

  /**
   * Looks an object up: the overlay first, then the board.
   *
   * @param id - The object id.
   * @returns The object, or `undefined` when there is none.
   */
  lookUp(id: ObjectId): BoardObject | undefined {
    return this.#overlay.get(id) ?? this.#reader.get(id);
  }

  /**
   * Gathers one object.
   *
   * @param id - The object id; nothing happens when there is no such object.
   * @returns The object, or `undefined`.
   */
  add(id: ObjectId): BoardObject | undefined {
    const object = this.lookUp(id);
    if (object !== undefined) this.#objects.set(id, object);
    return object;
  }

  /**
   * Gathers an object and its chain of parents up to the root, stopping at a missing parent
   * and at a parent cycle, which the schema's rules then report.
   *
   * @param id - The object id.
   */
  addWithAncestors(id: ObjectId): void {
    const walked = new Set<ObjectId>();
    let current = this.lookUp(id);
    while (current !== undefined && !this.#withAncestors.has(current.id)) {
      if (walked.has(current.id)) break;
      walked.add(current.id);
      this.#objects.set(current.id, current);
      current = current.parentId === null ? undefined : this.lookUp(current.parentId);
    }
    for (const walkedId of walked) this.#withAncestors.add(walkedId);
  }

  /**
   * Gathers an object and every object below it, through the reverse index of children.
   *
   * @param id - The object id.
   * @returns The ids gathered in this subtree, the object's first; empty when it is missing.
   */
  addSubtree(id: ObjectId): ObjectId[] {
    const gathered: ObjectId[] = [];
    const pending = [id];
    let next = pending.pop();
    while (next !== undefined) {
      if (!this.#withSubtree.has(next) && this.add(next) !== undefined) {
        this.#withSubtree.add(next);
        gathered.push(next);
        pending.push(...this.#reader.references.childrenOf(next));
      }
      next = pending.pop();
    }
    return gathered;
  }

  /**
   * Gathers what places a connector's ends: each attached end's target with its ancestors, and
   * a group target's subtree, whose derived bounds the end sits on. An automatic anchor picks the
   * side nearest the other end (the schema's `placeConnectorEnds`), so detaching one end measures
   * the other end's target too.
   *
   * @param connector - The connector, if it is one; anything else gathers nothing.
   */
  addConnectorTargets(connector: BoardObject | undefined): void {
    if (connector?.type !== 'connector') return;
    for (const end of [connector.from, connector.to]) {
      if (end.kind !== 'object') continue;
      if (this.lookUp(end.objectId)?.type === 'group') this.addSubtree(end.objectId);
      this.addWithAncestors(end.objectId);
    }
  }

  /**
   * Gathers referenced definitions and their nested placements without resolving copies: each
   * instance's stored main and the mains its records, or a gathered main's variant presets, name
   * as swap targets (`namedSwapTargets`), so a check that follows swaps finds them.
   *
   * @param id - An instance or container whose gathered content may reference mains.
   */
  addInstanceDefinitions(id: ObjectId): void {
    this.add(id);
    const visited = new Set<ObjectId>();
    // Objects gathered during the loop are visited too, so nested definitions are reached.
    for (const object of this.#objects.values()) {
      const mains = namedSwapTargets(object);
      if (object.type === 'instance') mains.unshift(object.mainId);
      for (const mainId of mains) {
        if (visited.has(mainId)) continue;
        visited.add(mainId);
        this.addSubtree(mainId);
        this.addWithAncestors(mainId);
      }
    }
  }

  /**
   * The gathered objects as a board for the schema's rules.
   *
   * @returns A new board, with the reader's pages when it reads them; later
   *   additions do not change it.
   */
  toBoard(): Board {
    const pages = this.#reader.readPages?.();
    return pages === undefined
      ? { objects: new Map(this.#objects) }
      : { objects: new Map(this.#objects), pages };
  }
}
