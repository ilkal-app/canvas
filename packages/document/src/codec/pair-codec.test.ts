import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { importBoard, type LineObject } from '@canvas/schema';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import { fromYjs, toYjs, writeObject } from './object-codec.js';

const DIVIDER = [...importBoard(createFixtureBoardJson()).objects.values()].find(
  (object): object is LineObject => object.id === 'line-divider',
);
if (DIVIDER === undefined) throw new Error('the fixture board has no line-divider');
const LINE: LineObject = DIVIDER;
const [START, END] = LINE.points;

/**
 * Stores the fixture line in a fresh document's object map, as the store does.
 *
 * @returns The line's integrated map.
 */
function integrate(): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(LINE.id, toYjs(LINE));
  return objects.get(LINE.id) as Y.Map<unknown>;
}

/**
 * Stores the fixture line as a board written before the split holds it: the whole pair under
 * `points`, and no key per end.
 *
 * @returns The line's integrated map.
 */
function integrateUnsplit(): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  // A line holds only plain values, so its stored entries copy as JSON.
  const stored = integrate().toJSON() as Record<string, unknown>;
  const entries = Object.entries(stored).filter(([key]) => !key.startsWith('points.'));
  objects.set(LINE.id, new Y.Map<unknown>([...entries, ['points', [START, END]]]));
  return objects.get(LINE.id) as Y.Map<unknown>;
}

/**
 * Decodes the fixture line from a map.
 *
 * @param map - The line's map.
 * @returns The line's points.
 */
function pointsOf(map: Y.Map<unknown>): unknown {
  const decoded = fromYjs(LINE.id, map);
  return 'object' in decoded && decoded.object.type === 'line' ? decoded.object.points : decoded;
}

const MOVED = { x: 40, y: -30 };

describe("a line's points, one key per end", () => {
  it('are stored as points.0 and points.1, with no whole pair', () => {
    const map = integrate();
    expect(map.get('points.0')).toEqual(START);
    expect(map.get('points.1')).toEqual(END);
    expect(map.has('points')).toBe(false);
    expect(pointsOf(map)).toEqual([START, END]);
  });

  it('write only the end that moved', () => {
    const map = integrate();
    const firstEnd = map.get('points.0');
    writeObject(map, { ...LINE, points: [START, MOVED] });
    expect(map.get('points.0')).toBe(firstEnd);
    expect(map.get('points.1')).toEqual(MOVED);
    expect(pointsOf(map)).toEqual([START, MOVED]);
  });
});

describe('a line stored before the split (the whole pair under points)', () => {
  it('reads both ends from the whole pair', () => {
    expect(pointsOf(integrateUnsplit())).toEqual([START, END]);
  });

  it('gets a key for an end the first time that end is written, and reads the other from the pair', () => {
    const map = integrateUnsplit();
    writeObject(map, { ...LINE, points: [START, MOVED] });
    expect(map.has('points.0')).toBe(false);
    expect(map.get('points.1')).toEqual(MOVED);
    expect(map.get('points')).toEqual([START, END]);
    expect(pointsOf(map)).toEqual([START, MOVED]);
    writeObject(map, { ...LINE, points: [MOVED, MOVED] });
    expect(map.get('points.0')).toEqual(MOVED);
    expect(pointsOf(map)).toEqual([MOVED, MOVED]);
  });

  it('writes no end key for a write that leaves the points alone', () => {
    const map = integrateUnsplit();
    writeObject(map, { ...LINE, endCap: 'arrow' });
    expect(map.has('points.0') || map.has('points.1')).toBe(false);
  });

  it('reports an end found under neither key as missing', () => {
    const map = integrateUnsplit();
    map.set('points', 'broken');
    expect(fromYjs(LINE.id, map)).toMatchObject({
      issue: { code: 'missing-field', field: 'points.0' },
    });
    map.set('points.0', START);
    expect(fromYjs(LINE.id, map)).toMatchObject({
      issue: { code: 'missing-field', field: 'points.1' },
    });
  });
});
