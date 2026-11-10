import type { Board } from '../board/board.js';
import { BOARD_BOUND } from '../fields/board-bound.js';
import {
  boardTransformOf,
  EXTENT_NAMES,
  geometryBoxOf,
  type ExtentName,
} from '../geometry/world-box.js';
import type { VersionedDocumentJson } from '../migrations/migration-step.js';
import type { BoardIssue } from '../rules/board-issue.js';
import { findValueLimitIssues } from '../rules/value-limits.js';

/**
 * The paths within a JSON value to every number in it that is not finite (a `1e400` literal
 * parses to Infinity).
 *
 * @param value - The value.
 * @returns The paths.
 */
function nonFinitePaths(value: unknown): (string | number)[][] {
  const found: (string | number)[][] = [];
  const path: (string | number)[] = [];
  const visit = (item: unknown): void => {
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) found.push([...path]);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child: unknown, index) => {
        path.push(index);
        visit(child);
        path.pop();
      });
    } else if (typeof item === 'object' && item !== null) {
      for (const [key, child] of Object.entries(item)) {
        path.push(key);
        visit(child);
        path.pop();
      }
    }
  };
  visit(value);
  return found;
}

/**
 * The numbers of a document's objects that are not finite, each an `out-of-bound` issue naming
 * the object and field: refused as past the bound, not as a malformed object, so a
 * paste says why it took nothing instead of pasting the copy's text.
 *
 * @param document - The migrated document.
 * @returns The issues.
 */
export function nonFiniteIssues(document: VersionedDocumentJson): BoardIssue[] {
  const objects: unknown = document.objects;
  if (!Array.isArray(objects)) return [];
  return objects.flatMap((object: unknown, index) => {
    const id =
      typeof object === 'object' &&
      object !== null &&
      'id' in object &&
      typeof object.id === 'string'
        ? object.id
        : null;
    return nonFinitePaths(object).map((path): BoardIssue => ({
      code: 'out-of-bound',
      objectId: id,
      relatedId: null,
      path: id === null ? ['objects', index, ...path] : path,
      message: `${path.join('.')} is not a finite number`,
    }));
  });
}

/** The field each extent of a box is placed by, which an issue names. */
const EXTENT_FIELD: Readonly<Record<ExtentName, string>> = {
  minX: 'x',
  maxX: 'x',
  minY: 'y',
  maxY: 'y',
};

/**
 * Where a board's objects are past the board's bound, each an `out-of-bound` issue: an
 * object whose box on the board, resolved through its parents, has an extent past ±`BOARD_BOUND`
 * or cannot be worked out (named by the field that places that extent, `x` or `y`), and every
 * value that is not a position past its limit (`findValueLimitIssues`). An imported board is new
 * to the board it goes into, so each object is held to the bound itself; a member's number
 * relative to its parent may exceed it.
 *
 * @param board - The board, valid by the schema and its reference rules.
 * @returns The issues.
 */
export function boundIssuesOf(board: Board): BoardIssue[] {
  const issue = (objectId: string, path: readonly (string | number)[], message: string) =>
    ({ code: 'out-of-bound', objectId, relatedId: null, path, message }) as const;
  return [...board.objects.values()].flatMap((object): BoardIssue[] => {
    const limits = findValueLimitIssues(object).map(({ path, message }) =>
      issue(object.id, path, message),
    );
    const transform = boardTransformOf(object, (id) => board.objects.get(id));
    const box = transform && geometryBoxOf(object, transform);
    if (transform === undefined) {
      return [...limits, issue(object.id, ['x'], 'its place on the board cannot be worked out')];
    }
    if (box === undefined) return limits;
    const past = EXTENT_NAMES.filter((name) => !(Math.abs(box[name]) <= BOARD_BOUND));
    const fields = [...new Set(past.map((name) => EXTENT_FIELD[name]))];
    return [
      ...limits,
      ...fields.map((field) =>
        issue(
          object.id,
          [field],
          `reaches (${String(box.minX)}..${String(box.maxX)}, ${String(box.minY)}..${String(box.maxY)}) on the board, past its bound of ±${String(BOARD_BOUND)} world units`,
        ),
      ),
    ];
  });
}
