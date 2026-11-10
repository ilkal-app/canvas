import {
  boardTransformOf,
  composeTransforms,
  findValueLimitIssues,
  placementTransform,
  type BoardObject,
  type ObjectId,
  type RigidTransform,
  type ValueLimitIssue,
} from '@canvas/schema';

import type { BoxSource } from './box-source.js';
import { judgeExtents, type ExtentsOutward, type PlaceLost } from './extent-rule.js';
import { worldBoxAt, type WorldBox } from './world-box.js';

/** One way a change breaks the board's bound, on one object. */
export type WorldBoundViolation =
  | {
      /** An extent of its box on the board would end further past the bound than it was. */
      readonly kind: 'extent';
      /** The object. */
      readonly objectId: ObjectId;
      /** Where it was, or `undefined` when it is new. */
      readonly before: WorldBox | undefined;
      /** Where it would be. */
      readonly after: WorldBox;
      /** Which extents, or that it would have no place that can be worked out. */
      readonly verdict: ExtentsOutward | PlaceLost;
    }
  | {
      /** A value that is not a position would pass its limit, or go further past it. */
      readonly kind: 'value';
      /** The object. */
      readonly objectId: ObjectId;
      /** The value, its limit and its field. */
      readonly issue: ValueLimitIssue;
      /** Its magnitude before, or `undefined` when the object is new. */
      readonly before: number | undefined;
    };

/**
 * The fields the bound reads: what places an object in its parent, its own geometry, and the
 * values with a limit of their own.
 */
const BOUND_FIELDS = [
  'x',
  'y',
  'rotation',
  'parentId',
  'width',
  'height',
  'points',
  'vertices',
  'segments',
  'from',
  'to',
  'anchor',
  'cornerRadius',
  'naturalSize',
  'crop',
] as const;

/**
 * Tells whether two objects hold the same values of every field the bound reads: then neither
 * they nor anything they carry moved, unless an ancestor did. Values are compared by identity,
 * which a patch that leaves a field alone keeps.
 *
 * @param before - The object before.
 * @param after - The object after.
 * @returns `true` when nothing the bound reads changed.
 */
function isSameGeometry(before: BoardObject, after: BoardObject): boolean {
  if (before === after) return true;
  const read = (object: BoardObject, key: (typeof BOUND_FIELDS)[number]): unknown =>
    (object as unknown as Readonly<Record<string, unknown>>)[key];
  return BOUND_FIELDS.every((key) => read(before, key) === read(after, key));
}

/**
 * Tells whether two transforms place a frame alike, `undefined` (no place) included.
 *
 * @param first - One transform.
 * @param second - The other.
 * @returns `true` when both are missing or all four numbers are equal.
 */
function isSamePlacement(
  first: RigidTransform | undefined,
  second: RigidTransform | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.cos === second.cos &&
    first.sin === second.sin
  );
}

/**
 * Tells whether a value past its limit is raised: new, or larger than it was. One that was NaN
 * and still is (a value a peer left so, which the change does not write:) stays.
 *
 * @param magnitude - Its magnitude after.
 * @param was - Its magnitude before, or `undefined` when it was within its limit or is new.
 * @param limit - Its limit.
 * @returns `true` when the change raises it.
 */
function isRaised(magnitude: number, was: number | undefined, limit: number): boolean {
  if (Number.isNaN(magnitude) && was !== undefined && Number.isNaN(was)) return false;
  return !(magnitude <= (was ?? limit));
}

/**
 * The values past their limit that a change raises (`findValueLimitIssues`): one that is new, or
 * larger than it was.
 *
 * @param before - The object before, or `undefined` when it is new.
 * @param after - The object after.
 * @returns One violation per value raised past its limit.
 */
function valueViolations(
  before: BoardObject | undefined,
  after: BoardObject,
): WorldBoundViolation[] {
  const issues = findValueLimitIssues(after);
  if (issues.length === 0) return [];
  const was = new Map(
    (before === undefined ? [] : findValueLimitIssues(before)).map((issue) => [
      issue.path.join('.'),
      issue.magnitude,
    ]),
  );
  return issues
    .filter((issue) => isRaised(issue.magnitude, was.get(issue.path.join('.')), issue.limit))
    .map((issue) => ({
      kind: 'value',
      objectId: after.id,
      issue,
      before: was.get(issue.path.join('.')),
    }));
}

/**
 * Judges one object's place, before and after.
 *
 * @param objectId - The object.
 * @param before - Where it was, or `undefined` when it is new.
 * @param after - Where it would be.
 * @param violations - Where to add a violation.
 */
function judgeOne(
  objectId: ObjectId,
  before: WorldBox | undefined,
  after: WorldBox,
  violations: WorldBoundViolation[],
): void {
  const verdict = judgeExtents(before, after);
  if (verdict.kind !== 'within') {
    violations.push({ kind: 'extent', objectId, before, after, verdict });
  }
}

/** What {@link carryDown} walks: the before and after sources and the changed ids. */
interface Carry {
  /** The board before the change. */
  readonly before: BoxSource;
  /** The board after the change. */
  readonly after: BoxSource;
  /** The objects the change writes; each is judged on its own. */
  readonly changed: ReadonlySet<ObjectId>;
  /** Where to add violations. */
  readonly violations: WorldBoundViolation[];
}

/**
 * Judges the descendants an object carries when its place on the board changes: each one not
 * itself changed keeps its place in its parent, so its transforms before and after are its
 * parent's composed with its own placement, worked out top-down in O(1) each, without walking
 * its chain again.
 *
 * @param carry - The sources, the changed ids and the violations.
 * @param root - The object whose place changed.
 * @param rootBefore - Its transform before, or `undefined`.
 * @param rootAfter - Its transform after, or `undefined`.
 */
function carryDown(
  carry: Carry,
  root: ObjectId,
  rootBefore: RigidTransform | undefined,
  rootAfter: RigidTransform | undefined,
): void {
  const seen = new Set<ObjectId>([root]);
  const pending: [ObjectId, RigidTransform | undefined, RigidTransform | undefined][] = [
    [root, rootBefore, rootAfter],
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [parentId, parentBefore, parentAfter] = next;
    for (const childId of carry.after.childrenOf(parentId)) {
      const child = carry.after.get(childId);
      if (child === undefined || seen.has(childId) || carry.changed.has(childId)) continue;
      seen.add(childId);
      const own = placementTransform(child.x, child.y, child.rotation);
      const toBefore = parentBefore && composeTransforms(parentBefore, own);
      const toAfter = parentAfter && composeTransforms(parentAfter, own);
      judgeOne(childId, worldBoxAt(child, toBefore), worldBoxAt(child, toAfter), carry.violations);
      pending.push([childId, toBefore, toAfter]);
    }
  }
}

/**
 * Finds where a change breaks the board's bound, decided from
 * the board before and after it alone, without knowing which fields a command drove: for every
 * object the change writes and every descendant it carries (when a parent moves, turns or
 * scales), each extent of its box on the board (`worldBoxOf`) obeys
 * `|after| <= max(BOARD_BOUND, |before|)` (`judgeExtents`), and each value that is not a position
 * stays within its limit or no further past it than it was (`findValueLimitIssues`). What a
 * command would write is judged by `runCommand`; a relay judging a peer's update would call it
 * with its board before the update, the scratch copy after it, and the ids the update touched.
 *
 * Cost: one walk up the chain of parents per changed object, then its descendants top-down in
 * O(1) each (two transforms, two boxes) when its place changed. A move of a group carrying 10,000
 * descendants is 10,000 of those.
 *
 * @param before - The board before the change.
 * @param after - The board after it.
 * @param changed - The objects the change writes (an id deleted is skipped).
 * @returns The violations; empty when the change keeps the bound.
 */
export function worldBoundViolations(
  before: BoxSource,
  after: BoxSource,
  changed: Iterable<ObjectId>,
): WorldBoundViolation[] {
  const carry: Carry = { before, after, changed: new Set(changed), violations: [] };
  for (const id of carry.changed) {
    const next = after.get(id);
    if (next === undefined) continue;
    const prior = before.get(id);
    const toAfter = boardTransformOf(next, (key) => after.get(key));
    const toBefore = prior && boardTransformOf(prior, (key) => before.get(key));
    const isPlacedAlike = prior !== undefined && isSamePlacement(toBefore, toAfter);
    if (isPlacedAlike && isSameGeometry(prior, next)) continue;
    carry.violations.push(...valueViolations(prior, next));
    const priorBox = prior === undefined ? undefined : worldBoxAt(prior, toBefore);
    judgeOne(id, priorBox, worldBoxAt(next, toAfter), carry.violations);
    if (!isPlacedAlike) carryDown(carry, id, toBefore, toAfter);
  }
  return carry.violations;
}
