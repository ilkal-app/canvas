// Written before the export code. CONTRACT: shown top-level frames become
// unpadded PDF sections in board reading order, with descendants included in their parent.
// Deliberately not asserted: rendering, PDF encoding, or ordering of coincident frames.
import { describe, expect, it, vi } from 'vitest';

import { createBoard, DEFAULT_PAGE, type BoardObject, type ObjectId } from '@canvas/schema';

import { memoryShape } from '../panels/__fixtures__/memory-board.js';

import { exportScopeOf } from './export-scope.js';
const { exportSectionsOf } = await vi.importActual<{
  exportSectionsOf: (
    board: ReturnType<typeof createBoard>,
    scope: NonNullable<ReturnType<typeof exportScopeOf>>,
  ) => readonly {
    id: ObjectId;
    name: string;
    rect: { x: number; y: number; width: number; height: number };
  }[];
}>('./export-sections.js');

const id = (value: string): ObjectId => value as ObjectId;

function frame(
  key: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId: ObjectId | null = null,
  isHidden = false,
): BoardObject {
  return {
    ...memoryShape(key, 'a0'),
    type: 'frame',
    name,
    x,
    y,
    width,
    height,
    parentId,
    clip: false,
    background: null,
    isHidden,
  };
}

function sectionScope(board: ReturnType<typeof createBoard>, ids?: readonly ObjectId[]) {
  const scope = exportScopeOf(
    board,
    ids === undefined ? { kind: 'page', pageId: DEFAULT_PAGE.id } : { kind: 'selection', ids },
  );
  if (scope === undefined) throw new Error('Expected nonempty scope');
  return scope;
}

describe('exportSectionsOf', () => {
  it('returns top-level frames in top-then-left reading order without mutating the board', () => {
    const lower = frame('lower', 'Lower', 100, 400, 200, 150);
    const right = frame('right', 'Right', 500, 100, 80, 90);
    const upper = frame('upper', 'Upper', 100, 100, 300, 200);
    const nested = frame('nested', 'Nested', 20, 30, 50, 60, id('upper'));
    const hidden = frame('hidden', 'Hidden', 0, 0, 40, 40, null, true);
    const board = createBoard([lower, nested, hidden, right, upper]);
    const before = structuredClone(board);
    const scope = sectionScope(board);
    expect(scope.shownIds.has(id('hidden'))).toBe(false);
    expect(exportSectionsOf(board, scope)).toEqual([
      { id: id('upper'), name: 'Upper', rect: { x: 100, y: 100, width: 300, height: 200 } },
      { id: id('right'), name: 'Right', rect: { x: 500, y: 100, width: 80, height: 90 } },
      { id: id('lower'), name: 'Lower', rect: { x: 100, y: 400, width: 200, height: 150 } },
    ]);
    expect(board).toEqual(before);
  });

  it('uses the frame selected, including its placement through parents', () => {
    const parent = frame('parent', 'Parent', 100, 200, 300, 200);
    const nested = frame('nested', 'Nested', 20, 30, 50, 60, id('parent'));
    const board = createBoard([parent, nested]);
    expect(exportSectionsOf(board, sectionScope(board, [id('nested')]))).toEqual([
      { id: id('nested'), name: 'Nested', rect: { x: 120, y: 230, width: 50, height: 60 } },
    ]);
    expect(exportSectionsOf(board, sectionScope(board, [id('parent')]))).toEqual([
      { id: id('parent'), name: 'Parent', rect: { x: 100, y: 200, width: 300, height: 200 } },
    ]);
  });

  it('returns no sections when the scope has shapes but no frames', () => {
    const shape = { ...memoryShape('shape', 'a0'), x: 20, y: 30 };
    const board = createBoard([shape]);
    expect(exportSectionsOf(board, sectionScope(board))).toEqual([]);
  });
});
