import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { layerKeyIntent } from './layer-keys.js';
import type { LayerRow } from './layer-rows.js';
import { renderedItems, scrollToShow, visibleRows } from './visible-rows.js';

describe('visibleRows', () => {
  it('renders the rows in view plus the overscan, within the list', () => {
    expect(visibleRows(50_000, 2_800, 480, 28, 8)).toEqual({ start: 92, end: 126 });
    expect(visibleRows(50_000, 0, 480, 28, 8)).toEqual({ start: 0, end: 26 });
    expect(visibleRows(10, 0, 480, 28, 8)).toEqual({ start: 0, end: 10 });
    expect(visibleRows(50_000, 50_000 * 28, 480, 28, 8)).toEqual({ start: 49_992, end: 50_000 });
  });

  it('treats a negative scroll or height as none', () => {
    expect(visibleRows(100, -50, -1, 28, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('scrollToShow', () => {
  it('scrolls up or down just enough to show a row, and not at all when it shows', () => {
    expect(scrollToShow(2, 280, 280, 28)).toBe(56);
    expect(scrollToShow(30, 280, 280, 28)).toBe(588);
    expect(scrollToShow(12, 280, 280, 28)).toBe(280);
  });
});

describe('renderedItems', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('renders the range, with indices', () => {
    expect(renderedItems(items, { start: 1, end: 3 }, 2)).toEqual([
      { index: 1, item: 'b' },
      { index: 2, item: 'c' },
    ]);
  });

  it('keeps the focus target rendered when it is scrolled away', () => {
    expect(renderedItems(items, { start: 3, end: 5 }, 0)).toEqual([
      { index: 3, item: 'd' },
      { index: 4, item: 'e' },
      { index: 0, item: 'a' },
    ]);
    expect(renderedItems([], { start: 0, end: 0 }, 0)).toEqual([]);
  });
});

describe('layerKeyIntent', () => {
  function row(id: string, fields: Partial<LayerRow> = {}): LayerRow {
    return {
      id: id as ObjectId,
      type: 'frame',
      name: id,
      parentId: null,
      level: 1,
      positionInSet: 1,
      setSize: 1,
      hasChildren: false,
      isExpanded: false,
      isLocked: false,
      isHidden: false,
      ...fields,
    };
  }
  const rows = [
    row('frame', { hasChildren: true, isExpanded: true }),
    row('child', { parentId: 'frame' as ObjectId, level: 2 }),
    row('closed', { hasChildren: true }),
    row('leaf'),
  ];

  it('moves up, down, home and end within the rows', () => {
    expect(layerKeyIntent(rows, 1, 'ArrowDown')).toEqual({ kind: 'focus', index: 2 });
    expect(layerKeyIntent(rows, 3, 'ArrowDown')).toEqual({ kind: 'focus', index: 3 });
    expect(layerKeyIntent(rows, 0, 'ArrowUp')).toEqual({ kind: 'focus', index: 0 });
    expect(layerKeyIntent(rows, 2, 'ArrowUp')).toEqual({ kind: 'focus', index: 1 });
    expect(layerKeyIntent(rows, 2, 'Home')).toEqual({ kind: 'focus', index: 0 });
    expect(layerKeyIntent(rows, 0, 'End')).toEqual({ kind: 'focus', index: 3 });
  });

  it('expands a collapsed row with Right, or moves into an expanded one', () => {
    expect(layerKeyIntent(rows, 2, 'ArrowRight')).toEqual({
      kind: 'expand',
      row: rows[2],
      isExpanded: true,
    });
    expect(layerKeyIntent(rows, 0, 'ArrowRight')).toEqual({ kind: 'focus', index: 1 });
    expect(layerKeyIntent(rows, 3, 'ArrowRight')).toBeUndefined();
  });

  it('collapses an expanded row with Left, or moves to the parent', () => {
    expect(layerKeyIntent(rows, 0, 'ArrowLeft')).toEqual({
      kind: 'expand',
      row: rows[0],
      isExpanded: false,
    });
    expect(layerKeyIntent(rows, 1, 'ArrowLeft')).toEqual({ kind: 'focus', index: 0 });
    expect(layerKeyIntent(rows, 3, 'ArrowLeft')).toBeUndefined();
  });

  it('selects with Enter and Space, and leaves other keys and empty lists alone', () => {
    expect(layerKeyIntent(rows, 3, 'Enter')).toEqual({ kind: 'select', row: rows[3] });
    expect(layerKeyIntent(rows, 3, ' ')).toEqual({ kind: 'select', row: rows[3] });
    expect(layerKeyIntent(rows, 3, 'a')).toBeUndefined();
    expect(layerKeyIntent([], 0, 'ArrowDown')).toBeUndefined();
  });
});
