// What lies under a creation's start point: the filled objects by
// their geometry, topmost first.
import { describe, expect, it, vi } from 'vitest';

import type { AssetId, BoardObject, ObjectId, PathObject, Rgba } from '@canvas/schema';

import { frame, group, rect } from '../select/__fixtures__/select-board.js';

import { chooseDefaultInk } from './default-ink.js';
import { colorsUnderPoint } from './under-point.js';

const BLACK = [0, 0, 0, 1] as const;

/**
 * A closed square path 0..100 with straight segments.
 *
 * @param objectId - Its id.
 * @param fill - Its fill; black by default.
 * @returns The path.
 */
function square(objectId: string, fill: PathObject['fill'] = [...BLACK]): PathObject {
  const base = rect(objectId, null, { x: 0, y: 0, width: 100, height: 100 });
  const corners = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ] as const;
  const vertices = corners.map(([x, y], index) => ({
    id: `v${String(index)}`,
    x,
    y,
    mirror: 'none' as const,
  }));
  const segments = corners.map((unused, index) => ({
    id: `s${String(index)}`,
    a: `v${String(index)}`,
    b: `v${String((index + 1) % corners.length)}`,
    ha: { x: 0, y: 0 },
    hb: { x: 0, y: 0 },
  }));
  return {
    id: base.id,
    parentId: base.parentId,
    x: base.x,
    y: base.y,
    rotation: base.rotation,
    z: base.z,
    locked: base.locked,
    createdBy: base.createdBy,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    type: 'path',
    vertices,
    segments,
    stroke: null,
    fill,
  } as unknown as PathObject;
}

describe('colorsUnderPoint', () => {
  it('fills a closed path by even-odd, and skips an unfilled one and a broken segment', () => {
    expect(colorsUnderPoint([square('p')], { x: 50, y: 50 })).toEqual([
      { kind: 'color', color: [...BLACK] },
    ]);
    expect(colorsUnderPoint([square('p')], { x: 150, y: 50 })).toEqual([]);
    expect(colorsUnderPoint([square('p', null)], { x: 50, y: 50 })).toEqual([]);
    const broken = square('p');
    const dangling = {
      ...broken,
      segments: [...broken.segments, { ...broken.segments[0], id: 'sx', b: 'missing' }],
    } as unknown as PathObject;
    expect(colorsUnderPoint([dangling], { x: 50, y: 50 })).toHaveLength(1);
  });

  it('shows nothing for an invisible paint and for an outline-only object', () => {
    const clear = {
      ...rect('c', null, { x: 0, y: 0, width: 100, height: 100 }),
      fill: [0, 0, 0, 0],
    };
    expect(colorsUnderPoint([clear as BoardObject], { x: 50, y: 50 })).toEqual([]);
    const lines = group('g', null, 0, 0, 0);
    expect(colorsUnderPoint([lines], { x: 0, y: 0 })).toEqual([]);
  });

  it('samples frames, stickies and images only inside their box', () => {
    const board = frame('f', null, { x: 0, y: 0, width: 100, height: 100 });
    expect(colorsUnderPoint([board], { x: 200, y: 50 })).toEqual([]);
    const base = rect('s', null, { x: 0, y: 0, width: 100, height: 100 });
    const sticky = { ...base, type: 'sticky', color: [1, 1, 0, 0] } as unknown as BoardObject;
    expect(colorsUnderPoint([sticky], { x: 50, y: 50 })).toEqual([]);
    expect(
      colorsUnderPoint([{ ...sticky, color: [1, 1, 0, 1] } as BoardObject], { x: 200, y: 0 }),
    ).toEqual([]);
    const image = {
      ...base,
      type: 'image',
      assetId: 'asset' as AssetId,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      naturalSize: { width: 100, height: 100 },
      opacity: 1,
    } as unknown as BoardObject;
    expect(colorsUnderPoint([image], { x: 200, y: 50 })).toEqual([]);
    expect(colorsUnderPoint([image], { x: 50, y: 50 })).toEqual([{ kind: 'pending' }]);
    expect(colorsUnderPoint([image], { x: 50, y: 50 }, () => [0.5, 0.5, 0.5, 1])).toEqual([
      { kind: 'color', color: [0.5, 0.5, 0.5, 1] },
    ]);
  });

  it('samples a rounded frame only inside its rounded corners', () => {
    const board = {
      ...frame('f', null, { x: 0, y: 0, width: 100, height: 100 }),
      cornerRadius: 40,
    };
    expect(colorsUnderPoint([board], { x: 2, y: 2 })).toEqual([]);
    expect(colorsUnderPoint([board], { x: 50, y: 50 })).toEqual([
      { kind: 'color', color: [1, 1, 1, 1] },
    ]);
  });

  it('resolves token fills in each object’s mode with the board’s tokens', () => {
    const tokens = new Map([
      [
        'brand',
        {
          id: 'brand',
          name: 'Brand',
          light: [1, 0, 0, 1] as Rgba,
          dark: [0, 0, 1, 1] as Rgba,
          builtin: false,
          createdBy: null,
          createdAt: 0,
        },
      ],
    ]);
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const loose = { ...rect('loose', null, box), fill: { token: 'brand' } } as BoardObject;
    const dark = { ...frame('dark', null, { ...box, x: 200 }), colorMode: 'dark' } as BoardObject;
    const framed = { ...rect('framed', 'dark', box), fill: { token: 'brand' } } as BoardObject;
    const at = (x: number, theme: 'light' | 'dark') =>
      colorsUnderPoint([loose, dark, framed], { x, y: 50 }, undefined, { theme, tokens });
    expect(at(50, 'light')).toEqual([{ kind: 'color', color: [1, 0, 0, 1] }]);
    expect(at(50, 'dark')).toEqual([{ kind: 'color', color: [0, 0, 1, 1] }]);
    expect(at(250, 'light')).toEqual([{ kind: 'color', color: [0, 0, 1, 1] }]);
    // Without a table or theme: the light theme's built-ins (an unknown token is ink).
    expect(colorsUnderPoint([loose], { x: 50, y: 50 })).toHaveLength(1);
  });

  it('samples an image only where it draws, at its opacity, over what lies below', () => {
    const white = {
      ...rect('w', null, { x: 0, y: 0, width: 200, height: 100 }),
      fill: [1, 1, 1, 1],
      z: 'a0',
    } as BoardObject;
    const black = (): Rgba => [0, 0, 0, 1];
    const picture = (opacity: number, naturalSize = { width: 200, height: 100 }) =>
      ({
        ...rect('i', null, { x: 0, y: 0, width: 200, height: 100 }),
        type: 'image',
        z: 'a5',
        assetId: 'asset' as AssetId,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        naturalSize,
        opacity,
      }) as unknown as BoardObject;
    // A translucent image composites over the opaque shape below it.
    expect(colorsUnderPoint([white, picture(0.1)], { x: 100, y: 50 }, black)).toEqual([
      { kind: 'color', color: [0, 0, 0, 0.1] },
      { kind: 'color', color: [1, 1, 1, 1] },
    ]);
    // An invisible image shows nothing, so the walk reaches the shape, and asks for no average.
    const unasked = vi.fn(black);
    expect(colorsUnderPoint([white, picture(0)], { x: 100, y: 50 }, unasked)).toEqual([
      { kind: 'color', color: [1, 1, 1, 1] },
    ]);
    expect(unasked).not.toHaveBeenCalled();
    // An asset whose average is fully transparent shows nothing either.
    expect(colorsUnderPoint([picture(1)], { x: 100, y: 50 }, () => [0, 0, 0, 0])).toEqual([]);
    // A square image fitted into a 200 × 100 box draws only from x = 50 to 150.
    const square = picture(1, { width: 100, height: 100 });
    expect(colorsUnderPoint([square], { x: 10, y: 50 }, black)).toEqual([]);
    expect(colorsUnderPoint([square], { x: 100, y: 50 }, black)).toEqual([
      { kind: 'color', color: [0, 0, 0, 1] },
    ]);
  });

  it('shows an image paint’s average colour on shapes, paths and frames', () => {
    const paint = {
      type: 'image',
      assetId: 'asset',
      naturalSize: { width: 100, height: 100 },
      fit: 'tile',
      crop: { x: 0, y: 0, width: 1, height: 1 },
    };
    const shape = {
      ...rect('s', null, { x: 0, y: 0, width: 100, height: 100 }),
      fill: paint,
    } as unknown as BoardObject;
    const path = square('p', paint as unknown as PathObject['fill']);
    const board = {
      ...frame('f', null, { x: 0, y: 0, width: 100, height: 100 }),
      background: paint,
    } as unknown as BoardObject;
    const grey = (): Rgba => [0.5, 0.5, 0.5, 1];
    for (const object of [shape, path, board]) {
      // Pending until the asset's average is known, then that average; a clear one shows nothing.
      expect(colorsUnderPoint([object], { x: 50, y: 50 })).toEqual([{ kind: 'pending' }]);
      expect(colorsUnderPoint([object], { x: 50, y: 50 }, grey)).toEqual([
        { kind: 'color', color: [0.5, 0.5, 0.5, 1] },
      ]);
      expect(colorsUnderPoint([object], { x: 50, y: 50 }, () => [0, 0, 0, 0])).toEqual([]);
    }
  });

  it('places children through their parents and paints them above, cutting a cycle', () => {
    const parent = { ...frame('f', null, { x: 100, y: 0, width: 100, height: 100 }), z: 'a5' };
    const child = {
      ...rect('c', 'f', { x: 0, y: 0, width: 50, height: 50 }),
      fill: [0, 0, 1, 0.5],
      z: 'a0',
    } as BoardObject;
    expect(colorsUnderPoint([parent, child], { x: 125, y: 25 })).toEqual([
      { kind: 'color', color: [0, 0, 1, 0.5] },
      { kind: 'color', color: [1, 1, 1, 1] },
    ]);
    const looped = { ...parent, parentId: 'c' as ObjectId };
    expect(colorsUnderPoint([looped, child], { x: 125, y: 25 })).toHaveLength(2);
  });
});

describe('the default colour over a translucent image', () => {
  it('contrasts with the image composited over the shape below, not with its average alone', () => {
    const white = {
      ...rect('w', null, { x: 0, y: 0, width: 200, height: 100 }),
      fill: [1, 1, 1, 1],
      z: 'a0',
    } as BoardObject;
    const veil = {
      ...rect('i', null, { x: 0, y: 0, width: 200, height: 100 }),
      type: 'image',
      z: 'a5',
      assetId: 'asset' as AssetId,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      naturalSize: { width: 200, height: 100 },
      opacity: 0.1,
    } as unknown as BoardObject;
    const chosen = chooseDefaultInk({
      point: { x: 100, y: 50 },
      objects: [white, veil],
      theme: 'light',
      averageColorOf: () => [0, 0, 0, 1],
    });
    // About [0.9, 0.9, 0.9] shows there: white fails 4.5:1 against it, so it is not chosen.
    expect(chosen).not.toEqual([1, 1, 1, 1]);
    expect(chosen).not.toBe('ink');
  });
});
