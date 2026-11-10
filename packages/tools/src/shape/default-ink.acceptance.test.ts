// Independent pure-boundary contract for the default colour at creation.
// The implementer exports chooseDefaultInk from the package root; this test supplies data,
// not a replacement implementation, and is deliberately red until that boundary exists.
import { describe, expect, it } from 'vitest';

import type { AssetId, BoardObject, Point, Rgba } from '@canvas/schema';

import * as tools from '../index.js';
import { rect } from '../select/__fixtures__/select-board.js';

type Color = Rgba | 'ink';
interface Choice {
  readonly point: Point;
  readonly objects: readonly BoardObject[];
  readonly theme: 'light' | 'dark';
  readonly explicitColor?: Color;
  readonly averageColorOf?: (assetId: string) => Rgba | null;
}
const choose = (overrides: Partial<Choice> = {}): Color => {
  const api = tools as unknown as { chooseDefaultInk: (input: Choice) => Color };
  expect(api.chooseDefaultInk, 'pure default-colour boundary is required').toBeTypeOf('function');
  return api.chooseDefaultInk({
    point: { x: 50, y: 25 },
    objects: [],
    theme: 'light',
    ...overrides,
  });
};
const box = (fill: unknown, z = 'a0'): BoardObject =>
  ({
    ...rect('under', null, { x: 0, y: 0, width: 100, height: 50 }),
    fill,
    z,
  }) as unknown as BoardObject;

const shared = () => {
  const object = rect('under', null, { x: 0, y: 0, width: 100, height: 50 });
  return {
    id: object.id,
    parentId: object.parentId,
    x: object.x,
    y: object.y,
    rotation: object.rotation,
    z: object.z,
    locked: object.locked,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    width: object.width,
    height: object.height,
  };
};

describe('default stroke choice', () => {
  it.each(['light', 'dark'] as const)('uses ink on empty %s canvas', (theme) => {
    expect(choose({ theme })).toBe('ink');
  });
  it('lets an explicit colour win, even when it has poor contrast', () => {
    expect(choose({ objects: [box([0, 0, 0, 1])], explicitColor: [0, 0, 0, 1] })).toEqual([
      0, 0, 0, 1,
    ]);
    expect(choose({ explicitColor: 'ink' })).toBe('ink');
  });
  it('stores fixed contrasting colours over dark and light fills in either theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(choose({ theme, objects: [box([0, 0, 0, 1])] })).toEqual([1, 1, 1, 1]);
      expect(choose({ theme, objects: [box([1, 1, 1, 1])] })).toEqual([
        31 / 255,
        31 / 255,
        31 / 255,
        1,
      ]);
    }
  });
  it('samples a gradient at the press rather than at its midpoint', () => {
    const fill = {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: [0, 0, 0, 1] },
        { offset: 1, color: [1, 1, 1, 1] },
      ],
    };
    expect(choose({ objects: [box(fill)], point: { x: 1, y: 25 } })).toEqual([1, 1, 1, 1]);
    expect(choose({ objects: [box(fill)], point: { x: 99, y: 25 } })).toEqual([
      31 / 255,
      31 / 255,
      31 / 255,
      1,
    ]);
  });
  it('uses the topmost filled object and falls through a transparent one', () => {
    const bottom = { ...box([0, 0, 0, 1]), id: 'bottom' } as BoardObject;
    const top = { ...box([1, 1, 1, 1], 'a1'), id: 'top' } as BoardObject;
    expect(choose({ objects: [top, bottom] })).toEqual([31 / 255, 31 / 255, 31 / 255, 1]);
    expect(choose({ objects: [{ ...top, fill: [1, 1, 1, 0] } as BoardObject, bottom] })).toEqual([
      1, 1, 1, 1,
    ]);
  });
});

describe('sampling boundaries', () => {
  it('ignores objects outside the press and outline-only objects', () => {
    expect(choose({ objects: [box([0, 0, 0, 1])], point: { x: 500, y: 500 } })).toBe('ink');
    expect(choose({ objects: [box(null)] })).toBe('ink');
  });
  it('composites translucent fills over lower objects before choosing', () => {
    const bottom = { ...box([0, 0, 0, 1]), id: 'bottom' } as BoardObject;
    const top = { ...box([1, 1, 1, 0.1], 'a1'), id: 'top' } as BoardObject;
    expect(choose({ objects: [bottom, top] })).toEqual([1, 1, 1, 1]);
  });
  it('samples sticky colours and frame backgrounds', () => {
    const sticky = {
      ...shared(),
      type: 'sticky',
      text: '',
      runs: [],
      align: 'left',
      autoWidth: false,
      verticalAlign: 'top',
      color: [0, 0, 0, 1],
    } as BoardObject;
    const frame = {
      ...shared(),
      type: 'frame',
      name: 'frame',
      clip: true,
      background: [0, 0, 0, 1],
    } as BoardObject;
    for (const object of [sticky, frame]) {
      expect(choose({ objects: [object] })).toEqual([1, 1, 1, 1]);
    }
  });
  it('uses image asset averages and returns ink while the average is pending', () => {
    const picture = {
      ...shared(),
      type: 'image',
      assetId: 'asset-photo' as AssetId,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      naturalSize: { width: 100, height: 50 },
      opacity: 1,
    } as BoardObject;
    expect(choose({ objects: [picture], averageColorOf: () => [0, 0, 0, 1] })).toEqual([
      1, 1, 1, 1,
    ]);
    expect(choose({ objects: [picture], averageColorOf: () => null })).toBe('ink');
  });
});

describe('geometry and palette contrast', () => {
  it.each(['ellipse', 'diamond'] as const)(
    'does not sample the unpainted bounding-box corner of a %s',
    (kind) => {
      const shape = { ...box([0, 0, 0, 1]), kind } as BoardObject;
      expect(choose({ objects: [shape], point: { x: 1, y: 1 } })).toBe('ink');
      expect(choose({ objects: [shape], point: { x: 50, y: 25 } })).toEqual([1, 1, 1, 1]);
    },
  );
  it('maps a rotated object back into its local fill box', () => {
    const shape = { ...box([0, 0, 0, 1]), x: 100, y: 100, rotation: Math.PI / 2 };
    expect(choose({ objects: [shape], point: { x: 75, y: 150 } })).toEqual([1, 1, 1, 1]);
    expect(choose({ objects: [shape], point: { x: 150, y: 125 } })).toBe('ink');
  });
  it('meets 4.5:1 for every opaque grey using the independent WCAG formula', () => {
    const luminance = (rgb: readonly number[]) =>
      rgb
        .slice(0, 3)
        .reduce(
          (sum, c, i) =>
            sum +
            (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) *
              ([0.2126, 0.7152, 0.0722][i] ?? 0),
          0,
        );
    for (let step = 0; step <= 100; step++) {
      const grey = step / 100;
      const chosen = choose({ objects: [box([grey, grey, grey, 1])] });
      expect(chosen).not.toBe('ink');
      if (chosen === 'ink') throw new Error('Painted backgrounds require a fixed colour');
      const foreground = luminance(chosen);
      const background = luminance([grey, grey, grey]);
      expect(
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
