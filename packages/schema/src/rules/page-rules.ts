import type { Board } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import type { PageId } from '../ids/page-id.js';
import type { BoardObject } from '../objects/board-object.js';
import { firstPageIdOf, isLivePage, rootPageIdOf, storedPageIdOf } from '../pages/board-pages.js';
import { MAX_PAGES } from '../pages/page.js';

import type { BoardIssue } from './board-issue.js';

/**
 * Checks an object's own `pageId`: a root object names a live page
 * (`missing-page`), an object in a group or frame names none (`invalid-page`).
 *
 * @param board - The board.
 * @param object - The object.
 * @returns Its page issues, if any.
 */
function membershipIssues(board: Board, object: BoardObject): BoardIssue[] {
  if (object.parentId !== null) {
    if (object.pageId === null || object.pageId === undefined) return [];
    const message = `"${object.id}" is in "${object.parentId}" and names page "${object.pageId}"; only a root object names its page`;
    return [
      {
        code: 'invalid-page',
        objectId: object.id,
        relatedId: object.pageId,
        path: ['pageId'],
        message,
      },
    ];
  }
  const pageId = rootPageIdOf(object);
  if (isLivePage(board, pageId)) return [];
  return [
    {
      code: 'missing-page',
      objectId: object.id,
      relatedId: pageId,
      path: ['pageId'],
      message: `page "${pageId}" is not a page of the board`,
    },
  ];
}

/**
 * Finds the page an object is shown on, remembering each answer: its root ancestor's page, or
 * the first page when that page is not live (a root object there is the `missing-page` issue
 * already, and the repair moves it to the first page, R1).
 *
 * @param board - The board.
 * @returns The lookup.
 */
function pageLookup(board: Board): (object: BoardObject) => PageId | undefined {
  const known = new Map<ObjectId, PageId | undefined>();
  const first = firstPageIdOf(board);
  return (object) => {
    if (known.has(object.id)) return known.get(object.id);
    const stored = storedPageIdOf(board, object);
    const pageId = stored === undefined || isLivePage(board, stored) ? stored : first;
    known.set(object.id, pageId);
    return pageId;
  };
}

/**
 * Checks that an object's references to other objects stay on its page: a
 * connector's attached ends and a comment's anchor. A reference to an object that is missing, or
 * whose chain of parents breaks, is the reference rules' to report.
 *
 * @param board - The board.
 * @param object - The object.
 * @param pageOf - The page lookup.
 * @returns The object's `cross-page` issues, if any.
 */
function crossPageIssues(
  board: Board,
  object: BoardObject,
  pageOf: (object: BoardObject) => PageId | undefined,
): BoardIssue[] {
  const references: [ObjectId, (string | number)[]][] = [];
  if (object.type === 'connector') {
    if (object.from.kind === 'object')
      references.push([object.from.objectId, ['from', 'objectId']]);
    if (object.to.kind === 'object') references.push([object.to.objectId, ['to', 'objectId']]);
  } else if (object.type === 'comment' && object.anchor.kind === 'object') {
    references.push([object.anchor.objectId, ['anchor', 'objectId']]);
  }
  if (references.length === 0) return [];
  const own = pageOf(object);
  const issues: BoardIssue[] = [];
  for (const [targetId, path] of references) {
    const target = board.objects.get(targetId);
    const targetPage = target === undefined ? undefined : pageOf(target);
    if (own === undefined || targetPage === undefined || own === targetPage) continue;
    const message = `"${targetId}" is on page "${targetPage}", and "${object.id}" on page "${own}"`;
    issues.push({ code: 'cross-page', objectId: object.id, relatedId: targetId, path, message });
  }
  return issues;
}

/**
 * The page rules of `validateBoard`, per object: membership and references
 * across pages.
 *
 * @param board - The board.
 * @returns A function giving one object's page issues.
 */
export function objectPageIssues(board: Board): (object: BoardObject) => BoardIssue[] {
  const pageOf = pageLookup(board);
  return (object) => [
    ...membershipIssues(board, object),
    ...crossPageIssues(board, object, pageOf),
  ];
}

/**
 * The board-level page rule: more live pages than `MAX_PAGES` is a notice, never an error, since
 * concurrent adds can legitimately produce it.
 *
 * @param board - The board.
 * @returns The notice, or nothing.
 */
export function pageCountIssues(board: Board): BoardIssue[] {
  const count = board.pages?.size ?? 0;
  if (count <= MAX_PAGES) return [];
  return [
    {
      code: 'page-count',
      objectId: null,
      relatedId: null,
      path: ['pages'],
      message: `the board has ${String(count)} pages; the limit is ${String(MAX_PAGES)}`,
      severity: 'notice',
    },
  ];
}
