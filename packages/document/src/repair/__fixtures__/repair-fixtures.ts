// Shared by the reference repair's two-client tests: both merge orders, a shape to create, and
// checks that two clients converged to a valid board and that their own repairs match.
import { expect } from 'vitest';

import {
  objectToBoardTransform,
  validateBoard,
  type Board,
  type BoardObject,
} from '@canvas/schema';

import { isHiddenMemberIssue } from '../../codec/decode-issue.js';
import { testEnvironment } from '../../commands/__fixtures__/command-fixtures.js';
import type { ChangeSet, DocumentStore } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';
import type { YjsDocumentStore } from '../../store/yjs-document-store.js';

/** Both merge orders: which client's concurrent write wins a field depends on its client id. */
export const ORDERS = [
  { name: "Ada's client id above Bob's", adaClientId: 2, bobClientId: 1 },
  { name: "Ada's client id below Bob's", adaClientId: 1, bobClientId: 2 },
] as const;

/** Bob's command environment: his own seeded ids. */
export const BOB_ENVIRONMENT = testEnvironment(23);

/**
 * A new shape for `createObject`.
 *
 * @param shapeId - Its id.
 * @param parentId - Its parent.
 * @param x - Its x in the parent's frame.
 * @returns The command's `object` input.
 */
export function newShape(shapeId: string, parentId: string | null, x: number) {
  return {
    type: 'shape' as const,
    id: shapeId,
    parentId,
    x,
    y: 10,
    rotation: 0.25,
    width: 100,
    height: 60,
    kind: 'rectangle' as const,
    cornerRadius: 0,
    sides: 4,
    fill: [1, 0, 0, 1] as [number, number, number, number],
    stroke: null,
    label: null,
  };
}

/**
 * A copy of a store's board.
 *
 * @param store - The store.
 * @returns The board.
 */
export function boardOf(store: DocumentStore): Board {
  return { objects: new Map(store.read().objects) };
}

/**
 * Checks both clients hold the same board and that it breaks no reference rule. Every entry is
 * readable; network members a merge left breaking the network rules may be hidden, and
 * both clients report the same ones.
 *
 * @param first - One store.
 * @param second - The other.
 */
export function expectValidAndConverged(first: YjsDocumentStore, second: YjsDocumentStore): void {
  expect(validateBoard(first.read())).toEqual([]);
  expect(first.read().issues.filter((issue) => !isHiddenMemberIssue(issue))).toEqual([]);
  expect(second.read().issues).toEqual(first.read().issues);
  expect(new Map(first.read().objects)).toEqual(new Map(second.read().objects));
  expect(internalsOf(first).repairReferences(new Set(first.read().objects.keys()))).toEqual([]);
}

/**
 * Records a store's own repairs: each system change set it makes, with the objects it wrote.
 *
 * @param store - The store.
 * @returns The repairs so far, filled as they happen.
 */
export function recordRepairs(
  store: DocumentStore,
): { changes: ChangeSet; written: BoardObject[] }[] {
  const repairs: { changes: ChangeSet; written: BoardObject[] }[] = [];
  store.subscribe((changes) => {
    if (changes.origin.kind !== 'system' || !changes.isLocal) return;
    const written = changes.updated.flatMap((updatedId) => store.get(updatedId) ?? []);
    repairs.push({ changes, written });
  });
  return repairs;
}

/**
 * The board transform of an object, rounded for comparison.
 *
 * @param board - The board holding it and its ancestors.
 * @param object - The object.
 * @returns cos, sin, x and y of its object-to-board transform.
 */
export function placementOf(board: Board, object: BoardObject): number[] {
  const { cos, sin, x, y } = objectToBoardTransform(board, object);
  return [cos, sin, x, y].map((value) => Math.round(value * 1e9) / 1e9);
}
