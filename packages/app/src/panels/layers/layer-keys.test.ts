import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { layerKeyIntent } from './layer-keys.js';
import type { LayerRow } from './layer-rows.js';

function row(id: string, parentId: string | null, level: number, fields: Partial<LayerRow> = {}) {
  return {
    id: id as ObjectId,
    type: 'shape',
    name: id,
    parentId: parentId as ObjectId | null,
    level,
    positionInSet: 1,
    setSize: 1,
    hasChildren: false,
    isExpanded: false,
    isLocked: false,
    isHidden: false,
    ...fields,
  } satisfies LayerRow;
}

// frame (expanded) > group (expanded) > leaf; then a collapsed frame and a root shape.
const ROWS: readonly LayerRow[] = [
  row('frame', null, 1, { type: 'frame', hasChildren: true, isExpanded: true }),
  row('group', 'frame', 2, { type: 'group', hasChildren: true, isExpanded: true }),
  row('leaf', 'group', 3),
  row('sibling', 'frame', 2),
  row('closed', null, 1, { type: 'frame', hasChildren: true }),
  row('shape', null, 1),
];

describe('layerKeyIntent', () => {
  it('moves up and down, and jumps with Home and End, within the rows', () => {
    expect(layerKeyIntent(ROWS, 2, 'ArrowDown')).toEqual({ kind: 'focus', index: 3 });
    expect(layerKeyIntent(ROWS, 5, 'ArrowDown')).toEqual({ kind: 'focus', index: 5 });
    expect(layerKeyIntent(ROWS, 2, 'ArrowUp')).toEqual({ kind: 'focus', index: 1 });
    expect(layerKeyIntent(ROWS, 0, 'ArrowUp')).toEqual({ kind: 'focus', index: 0 });
    expect(layerKeyIntent(ROWS, 3, 'Home')).toEqual({ kind: 'focus', index: 0 });
    expect(layerKeyIntent(ROWS, 3, 'End')).toEqual({ kind: 'focus', index: 5 });
  });

  it('opens a collapsed row with Right, then moves into it; a leaf takes no Right', () => {
    expect(layerKeyIntent(ROWS, 4, 'ArrowRight')).toEqual({
      kind: 'expand',
      row: ROWS[4],
      isExpanded: true,
    });
    expect(layerKeyIntent(ROWS, 1, 'ArrowRight')).toEqual({ kind: 'focus', index: 2 });
    expect(layerKeyIntent(ROWS, 2, 'ArrowRight')).toBeUndefined();
  });

  it('closes an open row with Left, else moves to its parent, past its siblings', () => {
    expect(layerKeyIntent(ROWS, 1, 'ArrowLeft')).toEqual({
      kind: 'expand',
      row: ROWS[1],
      isExpanded: false,
    });
    expect(layerKeyIntent(ROWS, 2, 'ArrowLeft')).toEqual({ kind: 'focus', index: 1 });
    expect(layerKeyIntent(ROWS, 3, 'ArrowLeft')).toEqual({ kind: 'focus', index: 0 });
    expect(layerKeyIntent(ROWS, 5, 'ArrowLeft')).toBeUndefined();
  });

  it('finds the parent of the last of 50k rows by scanning up, not copying the list', () => {
    const rows = [
      row('top', null, 1, { type: 'frame', hasChildren: true, isExpanded: true }),
      ...[...Array(50_000).keys()].map((index) => row(`child-${String(index)}`, 'top', 2)),
    ];
    const slice = rows.slice.bind(rows);
    let copies = 0;
    rows.slice = (...args) => {
      copies += 1;
      return slice(...args);
    };
    expect(layerKeyIntent(rows, 50_000, 'ArrowLeft')).toEqual({ kind: 'focus', index: 0 });
    expect(copies).toBe(0);
  });

  it('selects with Enter and Space, and takes no other key', () => {
    expect(layerKeyIntent(ROWS, 3, 'Enter')).toEqual({ kind: 'select', row: ROWS[3] });
    expect(layerKeyIntent(ROWS, 3, ' ')).toEqual({ kind: 'select', row: ROWS[3] });
    expect(layerKeyIntent(ROWS, 3, 'a')).toBeUndefined();
    expect(layerKeyIntent([], 0, 'ArrowDown')).toBeUndefined();
  });
});
