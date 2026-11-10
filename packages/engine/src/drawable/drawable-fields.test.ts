import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { imageObject } from '../images/__fixtures__/image-objects.js';
import {
  frameObject,
  groupObject,
  shapeObject,
  sourceOf,
} from '../scene/__fixtures__/scene-objects.js';
import {
  commentObject,
  connectorObject,
  lineObject,
  pathObject,
  stickyObject,
  textObject,
  videoObject,
} from '../spatial/__fixtures__/spatial-objects.js';

import { ownUndrawableReason } from './drawable-fields.js';
import { undrawableReasonOf } from './drawable-geometry.js';

const RUN_STYLE = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0, 0, 0, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};

/**
 * One object of every type, every optional numeric field filled in.
 *
 * @returns The objects.
 */
function everyType(): BoardObject[] {
  const connector = connectorObject('k');
  const comment = commentObject('m');
  return [
    shapeObject('s', {
      stroke: { color: [0, 0, 0, 1], width: 2 },
      label: { text: 'a', runs: [{ length: 1, style: RUN_STYLE }] },
    }),
    stickyObject('n'),
    textObject('t'),
    imageObject({ id: 'i' as ObjectId }),
    { ...videoObject('v'), trim: { startMs: 0, endMs: 10 } },
    frameObject('f'),
    lineObject('l'),
    pathObject(
      'p',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      {
        isFilled: true,
        handles: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      },
    ),
    {
      ...connector,
      from: { kind: 'object', objectId: 's' as ObjectId, anchor: { x: 0.5, y: 0.5 } },
      label: { text: 'b', runs: [{ length: 1, style: RUN_STYLE }] },
    },
    { ...comment, anchor: { kind: 'object', objectId: 's' as ObjectId, offset: { x: 1, y: 2 } } },
    groupObject('g'),
  ];
}

/** Fields the engine never reads: an object's timestamps. */
const UNREAD = new Set(['createdAt', 'updatedAt']);

/** The fields holding a size, at any depth. */
const SIZES = new Set(['width', 'height', 'cornerRadius', 'fontSize']);

/**
 * Every path to a number inside a value.
 *
 * @param value - The value.
 * @param path - The path to it.
 * @returns The paths, each a list of keys and indices.
 */
function numberPaths(
  value: unknown,
  path: readonly (string | number)[] = [],
): (string | number)[][] {
  if (typeof value === 'number') return [[...path]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    numberPaths(item, [...path, Array.isArray(value) ? Number(key) : key]),
  );
}

/**
 * A copy of an object with one number replaced.
 *
 * @param object - The object.
 * @param path - Where the number is.
 * @param next - The new number.
 * @returns The copy.
 * @throws {RangeError} When the path is empty.
 */
function withNumber(
  object: BoardObject,
  path: readonly (string | number)[],
  next: number,
): BoardObject {
  const copy = structuredClone(object) as unknown as Record<string | number, unknown>;
  const last = path.at(-1);
  if (last === undefined) throw new RangeError('A number sits under at least one key.');
  let target = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[last] = next;
  return copy as unknown as BoardObject;
}

describe('ownUndrawableReason', () => {
  it('draws every honest object of every type', () => {
    for (const object of everyType()) expect(ownUndrawableReason(object)).toBeUndefined();
  });

  it('judges every number every type holds: NaN and the infinities anywhere are refused', () => {
    for (const object of everyType()) {
      for (const path of numberPaths(object)) {
        if (UNREAD.has(String(path[0]))) continue;
        for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
          const where = `${object.type} ${path.join('.')} = ${String(value)}`;
          expect(ownUndrawableReason(withNumber(object, path, value)), where).toBe('not-finite');
        }
      }
    }
  });

  it('refuses a negative size anywhere, and one wider than the whole extent', () => {
    for (const object of everyType()) {
      for (const path of numberPaths(object)) {
        if (!SIZES.has(String(path.at(-1)))) continue;
        const where = `${object.type} ${path.join('.')}`;
        expect(ownUndrawableReason(withNumber(object, path, -1)), where).toBe('negative-size');
        expect(ownUndrawableReason(withNumber(object, path, 2 ** 33)), where).toBeDefined();
      }
    }
  });

  it('refuses every number past float32’s range: a GPU buffer would hold it as infinite', () => {
    for (const object of everyType()) {
      for (const path of numberPaths(object)) {
        if (UNREAD.has(String(path[0]))) continue;
        for (const value of [1e39, -1e39]) {
          const hostile = withNumber(object, path, value);
          const where = `${object.type} ${path.join('.')} = ${String(value)}`;
          expect(undrawableReasonOf(hostile, sourceOf([hostile])), where).toBeDefined();
        }
      }
    }
  });

  it('holds colours, opacity, crop, sides, strokes and font sizes to the schema’s ranges', () => {
    const shape = shapeObject('s', { kind: 'polygon', stroke: { color: [0, 0, 0, 1], width: 2 } });
    const image = imageObject({ id: 'i' as ObjectId });
    const sticky = stickyObject('n');
    const [run] = sticky.runs;
    if (run === undefined) throw new Error('the fixture sticky has a run');
    const outOfRange: BoardObject[] = [
      { ...shape, fill: [1e39, 0, 0, 1] },
      { ...shape, fill: [1.5, 0, 0, 1] },
      { ...shape, fill: [-0.25, 0, 0, 1] },
      { ...shape, sides: 0 },
      { ...shape, sides: 2 },
      { ...shape, sides: 3.5 },
      { ...shape, sides: 65 },
      { ...shape, sides: 1e9 },
      { ...shape, stroke: { color: [0, 0, 0, 1], width: 65 } },
      { ...shape, kind: 'hexagon' as never },
      { ...image, opacity: 1e39 },
      { ...image, opacity: 1.5 },
      { ...image, crop: { x: 1.5, y: 0, width: 1, height: 1 } },
      { ...image, crop: { x: 0, y: 0, width: 0, height: 1 } },
      { ...image, crop: { x: 0, y: 0, width: 1.5, height: 1 } },
      { ...image, naturalSize: { width: 0, height: 10 } },
      { ...image, naturalSize: { width: 1e-200, height: 1e-200 } },
      { ...image, naturalSize: { width: 1.5, height: 10 } },
      { ...image, naturalSize: { width: 2 ** 33, height: 10 } },
      { ...sticky, runs: [{ ...run, style: { ...run.style, fontSize: 3.9 } }] },
      { ...sticky, runs: [{ ...run, style: { ...run.style, fontSize: 401 } }] },
      { ...sticky, text: '', runs: [] },
      { ...sticky, text: 'ab', runs: [] },
      {
        ...sticky,
        text: 'ab',
        runs: [
          { ...run, length: 2 },
          { ...run, length: 0 },
        ],
      },
      { ...sticky, text: '', runs: [run, run] },
      { ...sticky, runs: [{ ...run, style: { ...run.style, fontSize: 0 } }] },
      { ...sticky, text: 'ab', runs: [{ ...run, length: 1e300 }] },
      { ...sticky, text: 'ab', runs: [{ ...run, length: 1 }] },
      { ...sticky, text: 'ab', runs: [{ ...run, length: 1.5 }] },
      lineObject('l', { endCap: 'spiral' as never }),
    ];
    for (const object of outOfRange) {
      expect(ownUndrawableReason(object), JSON.stringify(object)).toBe('out-of-range');
    }
    for (const sides of [3, 64]) expect(ownUndrawableReason({ ...shape, sides })).toBeUndefined();
    expect(ownUndrawableReason({ ...sticky, text: 'ab', runs: [{ ...run, length: 2 }] })).toBe(
      undefined,
    );
  });

  it('refuses a crop so small that the whole image behind it is past the extent', () => {
    const image = imageObject({ id: 'i' as ObjectId, width: 100, height: 100 });
    const natural = { width: 1, height: 1 };
    const tiny = (size: number) => ({ x: 0, y: 0, width: size, height: size });
    expect(ownUndrawableReason({ ...image, naturalSize: natural, crop: tiny(1e-310) })).toBe(
      'past-extent',
    );
    expect(ownUndrawableReason({ ...image, naturalSize: natural, crop: tiny(1e-300) })).toBe(
      'past-extent',
    );
    // 100 / 2^-24 is 2^30.6: within the extent.
    expect(ownUndrawableReason({ ...image, naturalSize: natural, crop: tiny(2 ** -24) })).toBe(
      undefined,
    );
  });

  it('judges the object’s own fields only, not its parent, its place or its timestamps', () => {
    expect(ownUndrawableReason(shapeObject('s', { parentId: 'gone', x: 1e308 }))).toBeUndefined();
    expect(ownUndrawableReason(shapeObject('s', { createdAt: Number.NaN }))).toBeUndefined();
  });
});
