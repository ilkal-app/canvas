// Engine acceptance fixtures: a whole board
// with pages, read through a counted `DefinitionSource` and a page view the way the app's
// `PageScopedStore` shows it; a harness that feeds an expansion the page view's change sets and
// the board's changed ids, applying what comes out to a main-thread mirror and, serialised, to
// the worker's `SceneSourceMirror`; and the oracle every mirror must equal: the shown real
// objects, retired mains and their subtrees left out, plus each shown instance's
// `resolveInstance` output over the whole board.
import { expect } from 'vitest';

import {
  createBoard,
  resolveInstance,
  type Board,
  type BoardObject,
  type ObjectId,
  type PageId,
} from '@canvas/schema';

import { SceneSourceMirror } from '../../host/scene-source-mirror.js';
import { serializeChangeSet } from '../../host/serializable-change-set.js';
import type { SceneChangeSet, SceneSource } from '../../scene/scene-source.js';

import { id, type Fields } from './component-objects.js';
import type {
  DefinitionSource,
  InstanceExpansionApi,
  InstanceExpansionClass,
} from './expected-api.js';

export * from './component-objects.js';

/** The page every root object is on when it names none (`DEFAULT_PAGE_ID`'s stand-in here). */
const UNNAMED_PAGE = 'default' as PageId;

/** One counted call on the definition source. */
export interface DefinitionRead {
  /** Which method. */
  readonly kind: 'get' | 'childrenOf' | 'instancesOf';
  /** Its argument. */
  readonly id: ObjectId | null;
}

/**
 * A whole board with pages: a counted `DefinitionSource` over every object, a page view over the
 * shown page, and change capture in both forms (the page view's change set, the board's ids).
 */
export class ComponentBoard {
  readonly objects = new Map<ObjectId, BoardObject>();
  /** Every definition read since the last `resetReads`. */
  readonly reads: DefinitionRead[] = [];
  private page: PageId | undefined;
  private shownIds = new Set<ObjectId>();
  private pending = new Set<ObjectId>();

  /** Whole-board reads, counted. */
  readonly definitions: DefinitionSource = {
    get: (objectId) => {
      this.reads.push({ kind: 'get', id: objectId });
      return this.objects.get(objectId);
    },
    childrenOf: (parentId) => {
      this.reads.push({ kind: 'childrenOf', id: parentId });
      return [...this.objects.values()].filter((o) => o.parentId === parentId).map((o) => o.id);
    },
    instancesOf: (mainId) => {
      this.reads.push({ kind: 'instancesOf', id: mainId });
      return [...this.objects.values()]
        .filter((o) => o.type === 'instance' && o.mainId === mainId)
        .map((o) => o.id);
    },
  };

  /** The page view's reads: the shown page's objects only. */
  readonly shown: SceneSource = {
    get: (objectId) => (this.isShown(objectId) ? this.objects.get(objectId) : undefined),
  };

  /**
   * Creates a board.
   *
   * @param objects - Its objects.
   * @param page - The page shown; undefined shows every page (a board without pages).
   */
  constructor(objects: readonly BoardObject[], page?: string) {
    for (const object of objects) this.objects.set(object.id, object);
    if (page !== undefined) this.page = page as PageId;
  }

  /**
   * The page a stored object is on: its root ancestor's.
   *
   * @param objectId - The object.
   * @returns The page, or undefined when it is not stored.
   */
  pageOf(objectId: ObjectId): PageId | undefined {
    let object = this.objects.get(objectId);
    const seen = new Set<ObjectId>();
    while (object?.parentId != null && !seen.has(object.id)) {
      seen.add(object.id);
      const parent = this.objects.get(object.parentId);
      if (parent === undefined) break;
      object = parent;
    }
    return object === undefined ? undefined : (object.pageId ?? UNNAMED_PAGE);
  }

  /**
   * Whether the page view shows a stored object.
   *
   * @param objectId - The object.
   * @returns True on the shown page (or on any page when none is chosen).
   */
  isShown(objectId: ObjectId): boolean {
    if (!this.objects.has(objectId)) return false;
    return this.page === undefined || this.pageOf(objectId) === this.page;
  }

  /**
   * The whole board, for the oracle.
   *
   * @returns Every stored object as a board.
   */
  board(): Board {
    return createBoard(this.objects.values());
  }

  /**
   * Stores objects, created or replaced.
   *
   * @param objects - Objects to store.
   */
  add(...objects: BoardObject[]): void {
    for (const object of objects) {
      this.objects.set(object.id, object);
      this.pending.add(object.id);
    }
  }

  /**
   * Replaces an object's fields.
   *
   * @param objectId - The object.
   * @param fields - Its new fields.
   * @throws {RangeError} When it is not stored.
   */
  update(objectId: string, fields: Fields): void {
    const object = this.objects.get(id(objectId));
    if (object === undefined) throw new RangeError(`no object "${objectId}"`);
    this.objects.set(object.id, { ...object, ...fields });
    this.pending.add(object.id);
  }

  /**
   * Removes objects, without their descendants.
   *
   * @param ids - Objects to remove.
   */
  remove(...ids: string[]): void {
    for (const objectId of ids) {
      this.objects.delete(id(objectId));
      this.pending.add(id(objectId));
    }
  }

  /**
   * Shows another page; the next `takeShown` is the switch.
   *
   * @param page - The page to show next.
   */
  show(page: string): void {
    this.page = page as PageId;
  }

  /** Forgets the counted reads. */
  resetReads(): void {
    this.reads.length = 0;
  }

  /**
   * The page view's change set since the last call, as `PageScopedStore` translates it: an
   * object arriving on the shown page is created, one leaving it deleted.
   *
   * @returns The change set, reading the page view.
   */
  takeShown(): SceneChangeSet {
    const now = new Set([...this.objects.keys()].filter((objectId) => this.isShown(objectId)));
    const was = this.shownIds;
    const changes: SceneChangeSet = {
      created: [...now].filter((objectId) => !was.has(objectId)),
      updated: [...this.pending].filter((objectId) => was.has(objectId) && now.has(objectId)),
      deleted: [...was].filter((objectId) => !now.has(objectId)),
      get: (objectId) => this.shown.get(objectId),
    };
    this.shownIds = now;
    return changes;
  }

  /**
   * The board's changed ids since the last call, on every page.
   *
   * @returns The ids.
   */
  takeBoard(): ObjectId[] {
    const ids = [...this.pending];
    this.pending.clear();
    return ids;
  }
}

/**
 * Whether an object is a retired main or sits below one.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns True when a retired component is it or an ancestor.
 */
function isRetiredSubtree(board: Board, object: BoardObject): boolean {
  const seen = new Set<ObjectId>();
  for (let at: BoardObject | undefined = object; at !== undefined && !seen.has(at.id);) {
    seen.add(at.id);
    if (at.type === 'component' && at.retired) return true;
    at = at.parentId === null ? undefined : board.objects.get(at.parentId);
  }
  return false;
}

/**
 * What the scene must hold for the shown page: the shown real objects without retired mains and
 * their subtrees, plus every shown instance's virtual descendants resolved over the whole board.
 *
 * @param board - The board.
 * @returns The objects by id.
 */
export function expectedScene(board: ComponentBoard): Map<string, BoardObject> {
  const whole = board.board();
  const scene = new Map<string, BoardObject>();
  for (const object of whole.objects.values()) {
    if (!board.isShown(object.id) || isRetiredSubtree(whole, object)) continue;
    scene.set(object.id, object);
    if (object.type !== 'instance') continue;
    for (const virtual of resolveInstance(whole, object).objects) scene.set(virtual.id, virtual);
  }
  return scene;
}

/**
 * Drives one expansion the way the app's feed does and keeps both mirrors of its output.
 */
export class ExpansionHarness {
  /** The expansion under test. */
  readonly expansion: InstanceExpansionApi;
  /** What the main-thread scene holds: every listed id's final state. */
  readonly mirror = new Map<string, BoardObject>();
  /** What the engine worker holds. */
  readonly worker = new SceneSourceMirror();
  /** Every change set the expansion produced, in order. */
  readonly outputs: SceneChangeSet[] = [];

  /**
   * Creates the expansion over the board's definitions.
   *
   * @param board - The board.
   * @param expansionClass - The expansion class under test.
   */
  constructor(
    readonly board: ComponentBoard,
    expansionClass: InstanceExpansionClass,
  ) {
    this.expansion = new expansionClass(board.definitions);
  }

  /**
   * Delivers the page view's change set to `expand`, then the board's ids to `dependentsOf`, as
   * `PageScopedStore` fires its page listeners before its board listeners.
   *
   * @returns What the expansion produced.
   */
  step(): SceneChangeSet[] {
    const shown = this.board.takeShown();
    const changed = this.board.takeBoard();
    const produced = [this.expansion.expand(shown)];
    const dependents = this.expansion.dependentsOf(changed, this.board.shown);
    if (dependents !== undefined) produced.push(dependents);
    for (const changes of produced) this.apply(changes);
    return produced;
  }

  private apply(changes: SceneChangeSet): void {
    this.outputs.push(changes);
    for (const listed of [...changes.created, ...changes.updated, ...changes.deleted]) {
      const object = changes.get(listed);
      if (object === undefined) this.mirror.delete(listed);
      else this.mirror.set(listed, object);
    }
    this.worker.apply(serializeChangeSet(changes));
  }

  /**
   * Asserts both mirrors hold exactly the oracle; `placeholders` lists instances whose extra
   * virtual objects (owned by them, not in the oracle) are their placeholder.
   *
   * @param placeholders - Instances expected to show a placeholder.
   */
  expectScene(placeholders: readonly string[] = []): void {
    const expected = expectedScene(this.board);
    const extra = [...this.mirror.keys()].filter((key) => !expected.has(key));
    const owners = new Set(extra.map((key) => this.expansion.ownerOf(key)));
    expect([...owners].sort()).toEqual([...placeholders].sort());
    const shown = new Map([...this.mirror].filter(([key]) => expected.has(key)));
    expect(shown).toEqual(expected);
    const worker = this.worker.everything();
    expect([...worker.created].sort()).toEqual([...this.mirror.keys()].sort());
    for (const key of worker.created) expect(worker.get(key)).toEqual(this.mirror.get(key));
  }

  /**
   * The ids listed by every output since `from`.
   *
   * @param from - The first output's index.
   * @returns The listed ids.
   */
  listedSince(from: number): Set<string> {
    return new Set(
      this.outputs.slice(from).flatMap((c) => [...c.created, ...c.updated, ...c.deleted]),
    );
  }
}
