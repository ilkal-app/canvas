import { describe, expect, it } from 'vitest';

import { isGradient, paintColorAt, resolvePaint } from '../fields/paint.js';

import { features, imported, onlyPath, onlyShape, svg } from './__fixtures__/svg-import-helpers.js';

describe('importSvg: paint', () => {
  it('reads colours, currentColor, opacity and the fill rule', () => {
    const value = imported(
      svg(
        '<g color="#00ff00" opacity="50%"><rect width="10" height="10" fill="currentColor" fill-opacity="0.5"/></g>' +
          '<rect width="10" height="10" style="fill: rgb(255, 0, 0) !important"/>' +
          '<g fill="blue"><rect width="10" height="10" fill="inherit"/></g>',
      ),
    );
    expect(value.objects.map((object) => object.fill)).toEqual([
      [0, 1, 0, 0.25],
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ]);
  });

  it('draws a sharp stroked rectangle as a path when the miter limit would bevel its corners', () => {
    const value = imported(
      svg('<rect width="10" height="10" fill="none" stroke="red" stroke-miterlimit="1"/>'),
    );
    expect(value.objects[0]?.type).toBe('path');
  });

  it('maps an objectBoundingBox linear gradient exactly', () => {
    const defs =
      '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>';
    const shape = onlyShape(imported(svg(`${defs}<rect width="40" height="20" fill="url(#g)"/>`)));
    expect(shape.fill).toEqual({
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: [1, 0, 0, 1] },
        { offset: 1, color: [0, 0, 1, 1] },
      ],
    });
  });

  it('maps a user-space gradient under a transform to the same colours at every point', () => {
    const markup = svg(
      '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="30" y2="20" gradientTransform="rotate(10)">' +
        '<stop offset="0.2" stop-color="red"/><stop offset="0.5" stop-color="#0f0" stop-opacity="0.5"/><stop offset="0.9" stop-color="blue"/></linearGradient></defs>' +
        '<path d="M0 0 H40 V40 H0 Z" fill="url(#g)" transform="translate(5 5) scale(1.5 1)"/>',
    );
    const path = onlyPath(imported(markup));
    // Probe the SVG gradient by hand: user point p → t = ((R⁻¹p − P1)·D)/|D|².
    const svgT = (x: number, y: number): number => {
      const cos = Math.cos(-Math.PI / 18);
      const sin = Math.sin(-Math.PI / 18);
      const gx = cos * x - sin * y;
      const gy = sin * x + cos * y;
      return ((gx - 10) * 20 + gy * 20) / 800;
    };
    for (const [x, y] of [
      [0, 0],
      [20, 10],
      [40, 40],
      [5, 35],
    ] as const) {
      // The user point's place in the path's unit box.
      const gx = 5 + 1.5 * x;
      const gy = 5 + y;
      const u = (gx - path.x) / 60;
      const v = (gy - path.y) / 40;
      const board = paintColorAt(resolvePaint(path.fill ?? [0, 0, 0, 0], 'light'), u, v);
      if (board === null) throw new Error('an SVG import never makes an image paint');
      const expected = paintColorAt(
        {
          type: 'linear',
          angle: 0,
          stops: [
            { offset: 0.2, color: [1, 0, 0, 1] },
            { offset: 0.5, color: [0, 1, 0, 0.5] },
            { offset: 0.9, color: [0, 0, 1, 1] },
          ],
        },
        svgT(x, y),
        0.5,
      );
      board.forEach((channel, index) => {
        expect(channel).toBeCloseTo(expected[index] ?? 0, 6);
      });
    }
  });

  it('maps a centred radial gradient exactly and approximates what the board cannot draw', () => {
    const radial = (attributes: string, transform = ''): string =>
      svg(
        `<defs><radialGradient id="r" ${attributes}><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient></defs>` +
          `<rect width="20" height="20" fill="url(#r)" ${transform}/>`,
      );
    expect(onlyShape(imported(radial(''))).fill).toEqual({
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: [
        { offset: 0, color: [1, 1, 1, 1] },
        { offset: 1, color: [0, 0, 0, 1] },
      ],
    });
    const focal = imported(radial('fx="0.2"'));
    expect(focal.issues.map((issue) => issue.detail)).toEqual([
      'a radial focal point is drawn at the centre',
    ]);
    for (const [attributes, transform] of [
      ['gradientTransform="scale(1 2)"', ''],
      ['cx="2"', ''],
      ['r="5"', ''],
      ['gradientTransform="nope(1)"', ''],
      ['gradientUnits="userSpaceOnUse" cx="50%"', ''],
      ['', 'transform="skewX(20)"'],
    ]) {
      const value = imported(radial(attributes ?? '', transform));
      expect(features(value), attributes).toContain('gradient');
      expect(Array.isArray(value.objects[0]?.fill), attributes).toBe(true);
    }
    expect(onlyShape(imported(radial('r="0"'))).fill).toEqual([0, 0, 0, 1]);
  });

  it('inherits stops and attributes along href, and reports spread methods and stop limits', () => {
    const value = imported(
      svg(
        '<defs><linearGradient id="base" x2="0" y2="1"><stop offset="0" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
          '<linearGradient id="g" href="#base" spreadMethod="reflect"/></defs>' +
          '<rect width="10" height="10" fill="url(#g)"/>',
      ),
    );
    expect(onlyShape(value).fill).toMatchObject({ type: 'linear', angle: Math.PI / 2 });
    expect(value.issues.map((issue) => issue.detail)).toEqual([
      'spreadMethod "reflect" drawn as "pad"',
    ]);
    const stops = Array.from(
      { length: 9 },
      (unused, index) =>
        `<stop offset="${String(index / 8)}" stop-color="${index % 2 === 0 ? 'red' : 'blue'}"/>`,
    ).join('');
    const many = imported(
      svg(
        `<defs><linearGradient id="g">${stops}</linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>`,
      ),
    );
    expect(features(many)).toEqual(['gradient stops']);
    const fill = onlyShape(many).fill ?? null;
    expect(isGradient(fill) ? fill.stops.length : 0).toBe(8);
  });

  it('handles degenerate gradients: no stops, one stop, zero length, a zero-size box, a bad stop colour', () => {
    const fillOf = (
      gradient: string,
      shape = '<rect width="10" height="10" fill="url(#g)"/>',
    ): unknown =>
      imported(svg(`<defs>${gradient}</defs>${shape}`)).objects[0]?.fill ?? 'nothing drawn';
    expect(fillOf('<linearGradient id="g"/>')).toBe('nothing drawn');
    expect(
      fillOf('<linearGradient id="g"><stop/><stop offset="1"/></linearGradient>'),
    ).toMatchObject({
      type: 'linear',
      stops: [{ color: [0, 0, 0, 1] }, { color: [0, 0, 0, 1] }],
    });
    // A singular gradientTransform has no frame to draw in: one colour, reported.
    expect(
      fillOf(
        '<linearGradient id="g" gradientTransform="scale(0)"><stop stop-color="red"/><stop offset="1" stop-color="red"/></linearGradient>',
      ),
    ).toEqual([1, 0, 0, 1]);
    expect(fillOf('<linearGradient id="g"><stop stop-color="red"/></linearGradient>')).toEqual([
      1, 0, 0, 1,
    ]);
    expect(
      fillOf(
        '<linearGradient id="g" x2="0"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>',
      ),
    ).toEqual([0, 0, 1, 1]);
    expect(
      fillOf(
        '<linearGradient id="g" x2="nope"><stop stop-color="red"/><stop offset="1" stop-color="red"/></linearGradient>',
      ),
    ).toEqual([1, 0, 0, 1]);
    const bad = imported(
      svg(
        '<defs><linearGradient id="g"><stop stop-color="nope"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>',
      ),
    );
    expect(features(bad)).toEqual(['paint']);
    // A horizontal line has a zero-height box: nothing to fill, and objectBoundingBox is degenerate.
    expect(
      fillOf(
        '<linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>',
        '<path d="M0 0 H10 V10" fill="url(#g)" transform="scale(1 0)"/>',
      ),
    ).toBe('nothing drawn');
  });

  it('reports patterns, missing references, unreadable colours and stroke gradients', () => {
    const value = imported(
      svg(
        '<defs><pattern id="p"/><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>' +
          '<rect width="10" height="10" fill="url(#p) green"/>' +
          '<rect width="10" height="10" fill="url(#p)"/>' +
          '<rect width="10" height="10" fill="url(#nothing)"/>' +
          '<rect width="10" height="10" fill="url(#nothing) blue"/>' +
          '<rect width="10" height="10" fill="nonsense"/>' +
          '<rect width="10" height="10" fill="none" stroke="url(#g)" stroke-linejoin="round"/>',
      ),
    );
    expect(value.objects.map((object) => object.fill ?? object.stroke?.color)).toEqual([
      [0, 128 / 255, 0, 1],
      [0, 0, 1, 1],
      // The stroke gradient's colour halfway along it.
      [0.5, 0, 0.5, 1],
    ]);
    const strokes = imported(
      svg(
        '<defs><linearGradient id="one"><stop stop-color="red"/></linearGradient><linearGradient id="none"/></defs>' +
          '<path d="M0 0 L10 0" stroke="url(#one)" stroke-linecap="round"/>' +
          '<path d="M0 0 L10 0" stroke="url(#none)" stroke-linecap="round"/>',
      ),
    );
    expect(strokes.objects.map((object) => object.stroke?.color)).toEqual([[1, 0, 0, 1]]);
    expect(features(value)).toEqual([
      'pattern',
      'pattern',
      'paint reference',
      'paint',
      'stroke gradient',
    ]);
  });
});

describe('importSvg: strokes', () => {
  it('keeps dashes, caps and joins, and caps the width', () => {
    const value = imported(
      svg(
        '<path d="M0 0 L10 0 L10 10" stroke="red" fill="none" stroke-width="80" stroke-dasharray="4 2"/>',
      ),
    );
    expect(features(value)).toEqual(['stroke-width']);
    expect(onlyPath(value).stroke?.width).toBe(64);
    expect(onlyPath(value)).toMatchObject({
      strokeDash: { pattern: [4, 2] },
      strokeJoin: 'miter',
      strokeCap: 'butt',
    });
    const zeroDash = imported(
      svg('<path d="M0 0 L10 0" stroke="red" stroke-linecap="round" stroke-dasharray="0 0"/>'),
    );
    expect(zeroDash.issues).toEqual([]);
  });

  it('keeps a non-scaling stroke unscaled, reports a stretched one, and drops a zero-width one', () => {
    const body = (extra: string): string =>
      svg(
        `<path d="M0 0 L10 0" stroke="red" stroke-linecap="round" transform="scale(3)" ${extra}/>`,
      );
    expect(onlyPath(imported(body('vector-effect="non-scaling-stroke"'))).stroke?.width).toBe(1);
    expect(onlyPath(imported(body(''))).stroke?.width).toBe(3);
    const stretched = imported(
      svg('<path d="M0 0 L10 0" stroke="red" stroke-linecap="round" transform="scale(4 1)"/>'),
    );
    expect(onlyPath(stretched).stroke?.width).toBe(2);
    expect(features(stretched)).toEqual(['stroke scaling']);
    expect(imported(body('stroke-width="0"')).objects).toEqual([]);
    expect(features(imported(body('stroke-width="1em"')))).toEqual(['stroke-width']);
  });
});

describe('importSvg: fill rules', () => {
  it('reports a nonzero fill that even-odd would draw differently', () => {
    const sameDirection = 'M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z';
    expect(features(imported(svg(`<path d="${sameDirection}"/>`)))).toEqual(['fill-rule']);
    expect(imported(svg(`<path d="${sameDirection}" fill-rule="evenodd"/>`)).issues).toEqual([]);
    expect(imported(svg('<path d="M0 0 H100 V100 H0 Z M25 25 V75 H75 V25 Z"/>')).issues).toEqual(
      [],
    );
    const zigzag = Array.from(
      { length: 2_001 },
      (unused, index) => `L${String(index)} ${String(index % 2)}`,
    );
    const complex = imported(svg(`<path d="M0 0 ${zigzag.join(' ')}"/>`));
    expect(complex.issues.map((issue) => issue.detail)).toEqual([
      'too complex to check; nonzero is drawn even-odd',
    ]);
  });
});
