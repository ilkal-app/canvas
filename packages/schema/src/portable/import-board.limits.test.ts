import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { BOARD_BOUND } from '../fields/board-bound.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import type { BoardObject } from '../objects/board-object.js';

import { BoardImportError } from './board-import-error.js';
import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';

// Fix round 3 (N4): an import (and so a paste) refuses what `createObject` refuses of the
// values that are not positions, with their own limits, and a number that is not finite (a `1e400`
// literal parses to Infinity), all as `out-of-bound`; and it judges positions by where each object
// lands on the board.

/**
 * The codes and places an import refuses a board with.
 *
 * @param json - The portable document.
 * @returns `[code, objectId, path]` for each issue.
 * @throws {Error} When the import succeeds, or fails with another error.
 */
function issuesOf(json: unknown): [string, string | null, string][] {
  try {
    importBoard(json);
  } catch (error) {
    if (error instanceof BoardImportError) {
      return error.issues.map((issue) => [issue.code, issue.objectId, issue.path.join('.')]);
    }
    throw error;
  }
  throw new Error('the import was expected to fail');
}

/**
 * The portable JSON of objects, as parsed from text.
 *
 * @param objects - The objects.
 * @returns The document.
 */
function documentOf(...objects: BoardObject[]): unknown {
  return JSON.parse(JSON.stringify(exportBoard(createBoard(objects)))) as unknown;
}

describe('importBoard and the limits of values that are not positions', () => {
  const shape = sampleObject('shape', 'shape', { x: 0, y: 0 });

  it('refuses a comment pin offset past its limit', () => {
    const comment = sampleObject('comment', 'pin', {
      anchor: { kind: 'object', objectId: 'shape' as ObjectId, offset: { x: 1e300, y: 0 } },
    });
    expect(issuesOf(documentOf(shape, comment))).toContainEqual([
      'out-of-bound',
      'pin',
      'anchor.offset.x',
    ]);
  });

  it('refuses a rotation, a corner radius and a natural size past their limits', () => {
    const turned = sampleObject('shape', 'turned', { rotation: 1e300 });
    const rounded = sampleObject('shape', 'rounded', { cornerRadius: 2 ** 31 });
    const image = sampleObject('image', 'photo');
    const huge = { ...image, naturalSize: { width: 2 ** 31, height: 10 } };
    const issues = issuesOf(documentOf(turned, rounded, huge));
    expect(issues).toContainEqual(['out-of-bound', 'turned', 'rotation']);
    expect(issues).toContainEqual(['out-of-bound', 'rounded', 'cornerRadius']);
    expect(issues).toContainEqual(['out-of-bound', 'photo', 'naturalSize.width']);
  });

  it('refuses a number that is not finite as out of bound, not as malformed', () => {
    const json = JSON.parse(
      JSON.stringify(exportBoard(createBoard([shape]))).replace('"x":0', '"x":1e400'),
    ) as unknown;
    expect(issuesOf(json)).toContainEqual(['out-of-bound', 'shape', 'x']);
  });

  it('refuses an object whose place on the board overflows', () => {
    const far = sampleObject('group', 'far', { x: 1e308, y: 0, rotation: 0 });
    const child = sampleObject('shape', 'child', {
      parentId: 'far' as ObjectId,
      x: 1e308,
      y: 0,
      rotation: 0,
    });
    expect(issuesOf(documentOf(far, child))).toContainEqual(['out-of-bound', 'child', 'x']);
  });

  it('imports values at their limits', () => {
    const edge = sampleObject('shape', 'edge', {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: BOARD_BOUND,
      cornerRadius: BOARD_BOUND,
    });
    expect(importBoard(documentOf(edge)).objects.get('edge' as ObjectId)).toMatchObject({
      rotation: BOARD_BOUND,
    });
  });
});
