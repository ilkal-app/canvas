import type { Board } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import { instanceReferenceProblems } from '../instances/instance-references.js';
import type { BoardObject } from '../objects/board-object.js';
import type { ConnectorEnd } from '../objects/connector-object.js';
import { unknownStyleIssues } from '../styles/named-style-refs.js';
import { unknownColorTokenIssues } from '../tokens/color-token-refs.js';

import type { BoardIssue } from './board-issue.js';
import { objectPageIssues, pageCountIssues } from './page-rules.js';

/**
 * Compares two ids by UTF-16 code units.
 *
 * @param first - One id.
 * @param second - The other id.
 * @returns A negative number, zero or a positive number, as `Array.prototype.sort` expects.
 */
function compareIds(first: string, second: string): number {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

/**
 * Finds every object whose chain of parents leads back to itself. Each object is walked at most
 * once, so the whole pass is linear in the board size.
 *
 * @param board - The board to check.
 * @returns The ids of the objects that lie on a parent cycle.
 */
function findObjectsOnParentCycles(board: Board): Set<ObjectId> {
  const onCycle = new Set<ObjectId>();
  const settled = new Set<ObjectId>();
  // One path and index, cleared per walk, so the pass allocates nothing per object.
  const path: ObjectId[] = [];
  const pathIndex = new Map<ObjectId, number>();
  for (const start of board.objects.values()) {
    path.length = 0;
    pathIndex.clear();
    let current: BoardObject | undefined = start;
    while (current !== undefined && !settled.has(current.id)) {
      const seenAt = pathIndex.get(current.id);
      if (seenAt !== undefined) {
        for (const cycleId of path.slice(seenAt)) onCycle.add(cycleId);
        break;
      }
      pathIndex.set(current.id, path.length);
      path.push(current.id);
      current = current.parentId === null ? undefined : board.objects.get(current.parentId);
    }
    for (const walkedId of path) settled.add(walkedId);
  }
  return onCycle;
}

/**
 * Checks an object's `parentId` against the board.
 *
 * @param board - The board holding the object.
 * @param object - The object to check.
 * @param isOnCycle - Whether the object lies on a parent cycle.
 * @returns The object's parent issues, if any.
 */
function parentIssues(board: Board, object: BoardObject, isOnCycle: boolean): BoardIssue[] {
  if (object.parentId === null) return [];
  const base = { objectId: object.id, relatedId: object.parentId, path: ['parentId'] };
  if (isOnCycle) {
    return [
      { ...base, code: 'parent-cycle', message: `the ancestors of "${object.id}" lead back to it` },
    ];
  }
  const parent = board.objects.get(object.parentId);
  if (parent === undefined) {
    return [
      {
        ...base,
        code: 'missing-parent',
        message: `parent "${object.parentId}" is not on the board`,
      },
    ];
  }
  if (parent.type !== 'group' && parent.type !== 'frame' && parent.type !== 'component') {
    const message = `parent "${parent.id}" is a ${parent.type}; only a group or frame can hold children`;
    return [{ ...base, code: 'invalid-parent', message }];
  }
  return [];
}

/**
 * Checks one attached connector end against the board: its target exists, is not the connector
 * itself, and is neither a connector nor a comment.
 *
 * @param board - The board holding the connector.
 * @param connectorId - The connector's id.
 * @param endName - Which end: `from` or `to`.
 * @param end - The end to check.
 * @returns The end's issues, if any.
 */
function connectorEndIssues(
  board: Board,
  connectorId: ObjectId,
  endName: 'from' | 'to',
  end: ConnectorEnd,
): BoardIssue[] {
  if (end.kind !== 'object') return [];
  const base = { objectId: connectorId, relatedId: end.objectId, path: [endName, 'objectId'] };
  const target = board.objects.get(end.objectId);
  if (target === undefined) {
    const message = `${endName} end targets "${end.objectId}", which is not on the board`;
    return [{ ...base, code: 'missing-connector-target', message }];
  }
  if (target.id === connectorId) {
    return [
      {
        ...base,
        code: 'invalid-connector-target',
        message: `${endName} end targets the connector itself`,
      },
    ];
  }
  if (target.type === 'connector' || target.type === 'comment') {
    const message = `${endName} end targets "${target.id}", a ${target.type}; connectors attach only to other kinds of object`;
    return [{ ...base, code: 'invalid-connector-target', message }];
  }
  return [];
}

/**
 * Checks the references an object makes to other objects beyond its parent: connector ends and
 * comment anchors.
 *
 * @param board - The board holding the object.
 * @param object - The object to check.
 * @returns The object's reference issues, if any.
 */
function referenceIssues(board: Board, object: BoardObject): BoardIssue[] {
  if (object.type === 'connector') {
    return [
      ...connectorEndIssues(board, object.id, 'from', object.from),
      ...connectorEndIssues(board, object.id, 'to', object.to),
    ];
  }
  if (object.type !== 'comment' || object.anchor.kind !== 'object') return [];
  const anchorId = object.anchor.objectId;
  const base = { objectId: object.id, relatedId: anchorId, path: ['anchor', 'objectId'] };
  const target = board.objects.get(anchorId);
  if (target === undefined) {
    return [
      {
        ...base,
        code: 'missing-comment-anchor',
        message: `anchor "${anchorId}" is not on the board`,
      },
    ];
  }
  if (target.type === 'comment') {
    return [
      {
        ...base,
        code: 'invalid-comment-anchor',
        message: `anchor "${anchorId}" is a comment; a pin cannot sit on a pin`,
      },
    ];
  }
  return [];
}

/**
 * Checks the references between a board's objects: every object is
 * stored under its own id; every `parentId` names a group or frame on the board and no chain of
 * parents loops; every attached connector end names another object that is neither a connector
 * nor a comment; every object-anchored comment names an object that is not a comment. The page
 * rules: a root object names a live page, an object in a group or frame
 * names none, a connector end or comment anchor stays on its object's page, and more live pages
 * than `MAX_PAGES` is a notice (`severity: 'notice'`). A colour naming a token the board does not
 * have is a notice too (`unknown-color-token`), and so is a style the board lacks
 * (`unknown-text-style`, `unknown-effect-style`). Field shapes are not rechecked here:
 * objects are expected to have passed `boardObjectSchema`.
 *
 * @param board - The board to check; it is not modified.
 * @returns Every issue found, ordered by object id (UTF-16 code units) and then by field; empty
 *   for a consistent board.
 */
export function validateBoard(board: Board): BoardIssue[] {
  const onCycle = findObjectsOnParentCycles(board);
  const pageIssuesOf = objectPageIssues(board);
  const issues: BoardIssue[] = pageCountIssues(board);
  for (const [id, problem] of instanceReferenceProblems(board)) {
    const object = board.objects.get(id);
    issues.push({
      code: problem.code,
      objectId: id,
      relatedId: object?.type === 'instance' ? object.mainId : null,
      path: ['mainId'],
      message: `instance "${id}" has ${problem.code}`,
    });
  }
  for (const [key, object] of board.objects) {
    if (object.id !== key) {
      const message = `object "${object.id}" is stored under the key "${key}"`;
      issues.push({
        code: 'id-mismatch',
        objectId: key,
        relatedId: object.id,
        path: ['id'],
        message,
      });
    }
    issues.push(
      ...parentIssues(board, object, onCycle.has(object.id)),
      ...referenceIssues(board, object),
      ...pageIssuesOf(object),
      ...unknownColorTokenIssues(board, object),
      ...unknownStyleIssues(board, object),
    );
  }
  // A stable sort keeps each object's issues in field order; only boards with issues pay for it.
  return issues.sort((first, second) => compareIds(first.objectId ?? '', second.objectId ?? ''));
}
