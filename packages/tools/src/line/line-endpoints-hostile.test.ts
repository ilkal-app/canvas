// A lone selected line a peer wrote past the command layer: at NaN or 1e308 it shows no
// end handles, so the overlay never carries a value that is not finite in float32.
import { describe, expect, it } from 'vitest';

import type { LineObject, ObjectId, Point } from '@canvas/schema';

import { id } from '../select/__fixtures__/select-board.js';
import { storeSource } from '../select/__fixtures__/select-store.js';

import { lineToolContext } from './__fixtures__/line-tool-context.js';
import { LineEndpoints } from './line-endpoints.js';

const LINE = id('line-l');

/**
 * Endpoint editing with line-l selected alone, read as `line` instead of as stored.
 *
 * @param change - What to change in the stored line.
 * @returns The editor.
 * @throws {Error} When the select board has no line-l.
 */
function editingOver(change: (line: LineObject) => LineObject): LineEndpoints {
  const { store, context } = lineToolContext();
  const stored = storeSource(store);
  const line = stored.get(LINE);
  if (line?.type !== 'line') throw new Error('the select board has line-l');
  const hostile = change(line);
  return new LineEndpoints({
    ...context,
    source: { ...stored, get: (key: ObjectId) => (key === LINE ? hostile : stored.get(key)) },
    selection: () => [LINE],
  });
}

/**
 * A line whose second end is at a point.
 *
 * @param end - The end.
 * @returns The change.
 */
function endAt(end: Point): (line: LineObject) => LineObject {
  return (line) => ({ ...line, points: [line.points[0], end] });
}

describe('LineEndpoints on a line that cannot be drawn', () => {
  it('shows handles on an honest line', () => {
    const endpoints = editingOver((line) => line);
    expect(endpoints.editableLine()?.id).toBe(LINE);
    expect(endpoints.overlay()?.toolRects?.length).toBeGreaterThan(0);
  });

  it('shows none on a line with an end at NaN or 1e308, which stays deletable by id', () => {
    for (const end of [
      { x: Number.NaN, y: 0 },
      { x: 1e308, y: 0 },
    ]) {
      const endpoints = editingOver(endAt(end));
      expect(endpoints.editableLine()).toBeUndefined();
      expect(endpoints.overlay()).toBeUndefined();
    }
  });
});
