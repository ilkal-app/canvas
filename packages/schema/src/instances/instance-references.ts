import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';
import type { InstanceObject } from '../objects/instance-object.js';

import { definitionContent } from './definition-content.js';
import { MAX_INSTANCE_DEPTH } from './instance-limits.js';

/** Why a stored instance reference cannot be expanded completely. */
export type InstanceReferenceIssue =
  'missing-main' | 'invalid-main' | 'instance-cycle' | 'instance-depth';

/** A bad expansion path, including the actual source placements a repair may re-root. */
export interface InstanceReferenceProblem {
  /** The violated reference rule. */
  readonly code: InstanceReferenceIssue;
  /** Source instances on the cycle, or the expansion chain exceeding the depth limit. */
  readonly chain: readonly ObjectId[];
}

/** Reusable indexes and successful depth checks within one immutable board. */
interface ReferenceWalk {
  readonly board: Board;
  readonly children: ChildIndex;
  readonly definitions: Map<ObjectId, readonly InstanceObject[]>;
  readonly valid: Set<string>;
}

/**
 * Finds nested reference edges without expanding or copying their definitions.
 *
 * @param walk - The indexed board.
 * @param mainId - The main to read.
 * @returns Its contained instance placements.
 */
function nestedInstances(walk: ReferenceWalk, mainId: ObjectId): readonly InstanceObject[] {
  const cached = walk.definitions.get(mainId);
  if (cached !== undefined) return cached;
  const instances = definitionContent(walk.board, mainId, walk.children).filter(
    (object): object is InstanceObject => object.type === 'instance',
  );
  instances.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  walk.definitions.set(mainId, instances);
  return instances;
}

/**
 * Checks a bounded reference expansion; it recurses at most six times.
 *
 * @param walk - The indexed board and successful checks.
 * @param instance - The next source placement.
 * @param mains - Main ids already on this expansion path.
 * @param chain - Source placements already traversed.
 * @returns The first invalid path, or undefined.
 */
function problemOnPath(
  walk: ReferenceWalk,
  instance: InstanceObject,
  mains: readonly ObjectId[],
  chain: readonly ObjectId[],
): InstanceReferenceProblem | undefined {
  const path = [...chain, instance.id];
  const main = walk.board.objects.get(instance.mainId);
  if (main === undefined) return { code: 'missing-main', chain: path };
  if (main.type !== 'component') return { code: 'invalid-main', chain: path };
  const cycleAt = mains.indexOf(main.id);
  if (cycleAt >= 0) return { code: 'instance-cycle', chain: path.slice(cycleAt + 1) };
  if (path.length > MAX_INSTANCE_DEPTH) return { code: 'instance-depth', chain: path };
  const key = `${main.id}/${String(path.length)}`;
  if (walk.valid.has(key)) return undefined;
  for (const nested of nestedInstances(walk, main.id)) {
    const problem = problemOnPath(walk, nested, [...mains, main.id], path);
    if (problem !== undefined) return problem;
  }
  walk.valid.add(key);
  return undefined;
}

/**
 * Checks all instance references on one board using shared definition indexes. Retired mains
 * remain valid sources; commands separately refuse new placement of a known retired main.
 *
 * @param board - The board to check without mutation.
 * @returns Invalid instances and the source paths causing their issue.
 */
export function instanceReferenceProblems(
  board: Board,
): ReadonlyMap<ObjectId, InstanceReferenceProblem> {
  const walk: ReferenceWalk = {
    board,
    children: buildChildIndex(board),
    definitions: new Map(),
    valid: new Set(),
  };
  const problems = new Map<ObjectId, InstanceReferenceProblem>();
  for (const object of board.objects.values()) {
    if (object.type !== 'instance') continue;
    const problem = problemOnPath(walk, object, [], []);
    if (problem !== undefined) problems.set(object.id, problem);
  }
  return problems;
}
