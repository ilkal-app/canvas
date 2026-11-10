import { describe, expect, it } from 'vitest';

import { FIGMA_ICON, OUTLINE_ICONS } from './__fixtures__/svg-fixtures.js';
import {
  features,
  imported,
  onlyPath,
  onlyShape,
  points,
  svg,
} from './__fixtures__/svg-import-helpers.js';
import type { SvgImportedPath } from './svg-import.js';

describe('importSvg: the icon set', () => {
  it('imports every outline icon with its strokes scaled to the size asked, reporting nothing', () => {
    for (const [name, markup] of Object.entries(OUTLINE_ICONS)) {
      const value = imported(markup, { width: 48, currentColor: [0.2, 0.4, 0.6, 1] });
      expect(value.issues, name).toEqual([]);
      expect(value.width).toBe(48);
      expect(value.height).toBe(48);
      expect(value.objects.length, name).toBeGreaterThan(0);
      for (const object of value.objects) {
        expect(object.stroke, name).toEqual({ color: [0.2, 0.4, 0.6, 1], width: 4 });
        expect(object.fill, name).toBeNull();
      }
    }
  });

  it('draws a stroked circle and rounded rectangle as exact shapes, the stroke centred on the box', () => {
    // The shape keeps the element's box and centres its outline on the edge, as SVG.
    const search = imported(OUTLINE_ICONS.search ?? '', { width: 48 });
    expect(search.objects[0]).toMatchObject({
      type: 'shape',
      kind: 'ellipse',
      x: 6,
      y: 6,
      width: 32,
      height: 32,
      rotation: 0,
      stroke: { width: 4 },
      strokeAlign: 'center',
    });
    const frame = imported(OUTLINE_ICONS.frame ?? '', { width: 48 });
    expect(frame.objects[0]).toMatchObject({
      type: 'shape',
      kind: 'rectangle',
      x: 6,
      y: 6,
      width: 36,
      height: 36,
      cornerRadius: 4,
      strokeAlign: 'center',
    });
  });

  it('imports a Figma export: its even-odd path, and no report for a clip that clips nothing', () => {
    const value = imported(FIGMA_ICON);
    const path = onlyPath(value);
    expect(value.issues).toEqual([]);
    expect(path.fill).toEqual([30 / 255, 31 / 255, 28 / 255, 1]);
    expect(path.stroke).toBeNull();
    // Two loops (the disc and the hole) of four arcs each.
    expect(path.vertices).toHaveLength(8);
  });
});

describe('importSvg: geometry', () => {
  it('reads every basic shape as an outline', () => {
    const value = imported(
      svg(
        '<line x1="0" y1="0" x2="10" y2="0" stroke="red"/>' +
          '<polyline points="0 10 10 10 10 20" stroke="red" fill="none"/>' +
          '<polygon points="20 0 30 0 25 10" fill="blue"/>' +
          '<rect x="40" y="0" width="10" height="10" rx="2" ry="3" fill="blue"/>' +
          '<ellipse cx="70" cy="10" rx="10" fill="blue"/>',
      ),
    );
    expect(value.objects.map((object) => object.type)).toEqual([
      'path',
      'path',
      'path',
      'path',
      'shape',
    ]);
    expect(points(value.objects[2] as SvgImportedPath)).toEqual([
      [20, 0],
      [30, 0],
      [25, 10],
    ]);
    // rx ≠ ry: no shape draws it, so a path with eight vertices (four arcs, four sides).
    expect((value.objects[3] as SvgImportedPath).vertices).toHaveLength(8);
    // An ellipse with one radius uses it for both.
    expect(value.objects[4]).toMatchObject({ kind: 'ellipse', width: 20, height: 20 });
  });

  it('draws nothing for empty shapes and reports unreadable lengths and points', () => {
    const value = imported(
      svg(
        '<rect width="0" height="10"/><circle r="0"/><polygon points=""/><path d=""/><path/><polyline/>' +
          '<path d="M5 5 L5 5" stroke="red"/>' +
          '<rect width="1em" height="10"/><circle r="1em"/><line x1="1em"/><polyline points="0 0 x"/>',
      ),
    );
    expect(value.objects).toEqual([]);
    expect(value.issues.map((issue) => issue.detail)).toEqual([
      '<rect> width="1em" is not in user units; not drawn',
      '<circle> r="1em" is not in user units; not drawn',
      '<line> x1="1em" is not in user units; not drawn',
      '<polyline> points are unreadable; not drawn',
    ]);
  });

  it('gives an ellipse with only ry that radius for both', () => {
    expect(onlyShape(imported(svg('<ellipse cx="10" cy="10" ry="5" fill="red"/>')))).toMatchObject({
      width: 10,
      height: 10,
    });
  });

  it("measures an objectBoundingBox from the curve's extremes, not its control points", () => {
    const defs =
      '<defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>';
    // The curve's bottom is y = 50; its cubic control points reach 66.7, the paint box's bottom.
    // So the bbox spans y −10..50 and the paint box −10..66.7: the last stop lands at 60 / 76.7.
    const arch = onlyPath(
      imported(svg(`${defs}<path d="M0 0 Q50 100 100 0 L100 -10 L0 -10 Z" fill="url(#g)"/>`)),
    );
    const stops = (arch.fill as { stops: { offset: number }[] }).stops;
    expect(stops.map((stop) => Number(stop.offset.toFixed(6)))).toEqual([0, 0.782609, 1]);
    // A cubic monotone in x (its derivative never zero) keeps its ends as its x bounds.
    const swoosh = onlyPath(
      imported(svg(`${defs}<path d="M0 0 C40 0 60 100 100 100 Z" fill="url(#g)"/>`)),
    );
    expect(swoosh.fill).toMatchObject({ type: 'linear' });
  });

  it('applies transforms, nested, and the viewBox', () => {
    const value = imported(
      svg(
        '<g transform="translate(10 20)"><path transform="scale(2)" d="M0 0 L5 0 L5 5" stroke="red" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>',
        'viewBox="0 0 50 50" width="100" height="100"',
      ),
    );
    // viewBox doubles, then translate, then scale: (0,0) → (20, 40), (5, 0) → (40, 40).
    expect(points(onlyPath(value))).toEqual([
      [20, 40],
      [40, 40],
      [40, 60],
    ]);
    expect(onlyPath(value).stroke?.width).toBe(4);
  });

  it('turns arcs into cubics on the curve', () => {
    const path = onlyPath(
      imported(
        svg(
          '<path d="M0 50 A50 50 0 0 1 100 50" stroke="red" stroke-linecap="round" fill="none"/>',
        ),
      ),
    );
    expect(path.segments).toHaveLength(2);
    expect(points(path)[1]).toEqual([50, 0]);
  });

  it('keeps a rotated rectangle a shape, and draws a skewed one as a path', () => {
    const rotated = onlyShape(
      imported(
        svg('<rect x="10" y="10" width="20" height="10" transform="rotate(90 10 10)" fill="red"/>'),
      ),
    );
    expect(rotated.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(rotated.x).toBeCloseTo(10, 12);
    expect(rotated.y).toBeCloseTo(10, 12);
    expect(rotated.width).toBe(20);
    const isMirrored = onlyShape(
      imported(
        svg('<rect x="0" y="0" width="20" height="10" transform="scale(1 -1)" fill="red"/>'),
      ),
    );
    expect(isMirrored).toMatchObject({ x: 0, y: -10, width: 20, height: 10, rotation: 0 });
    const skewed = imported(svg('<rect width="20" height="10" transform="skewX(30)" fill="red"/>'));
    expect(onlyPath(skewed).vertices).toHaveLength(4);
    const stretchedRound = imported(
      svg('<rect width="20" height="10" rx="2" transform="scale(2 1)" fill="red"/>'),
    );
    expect(stretchedRound.objects[0]?.type).toBe('path');
  });

  it('draws a stroked shape as a path when no shape matches it exactly', () => {
    const cases = [
      '<ellipse cx="50" cy="50" rx="20" ry="10" fill="none" stroke="red"/>',
      '<rect width="10" height="10" fill="none" stroke="red" stroke-opacity="0.5"/>',
      '<rect width="10" height="10" fill="none" stroke="red" stroke-linejoin="round"/>',
      '<rect width="10" height="10" fill="none" stroke="red" stroke-dasharray="2 2"/>',
      '<rect width="10" height="10" fill="none" stroke="red" transform="scale(2 1)"/>',
      '<rect width="10" height="10" fill="none" stroke="red" stroke-width="1em"/>',
    ];
    for (const body of cases) {
      expect(imported(svg(body)).objects[0]?.type, body).toBe('path');
    }
    // A sharp rectangle with the default mitre join is a shape.
    expect(
      imported(svg('<rect width="10" height="10" fill="none" stroke="red"/>')).objects[0]?.type,
    ).toBe('shape');
  });

  it('splits a filled and stroked open path into a closed fill under an open stroke', () => {
    const value = imported(
      svg(
        '<path d="M0 0 L50 0 L50 50" fill="blue" stroke="red" stroke-linecap="round" stroke-linejoin="round"/>',
      ),
    );
    expect(value.objects).toHaveLength(2);
    const [fill, stroke] = value.objects as SvgImportedPath[];
    expect(fill?.stroke).toBeNull();
    expect(fill?.segments).toHaveLength(3);
    expect(stroke?.fill).toBeNull();
    expect(stroke?.segments).toHaveLength(2);
    // A fill alone closes its open subpaths in one object.
    const filled = onlyPath(imported(svg('<path d="M0 0 L50 0 L50 50" fill="blue"/>')));
    expect(filled.segments).toHaveLength(3);
  });
});

describe('importSvg: sizing', () => {
  it('fits the viewBox to the size asked, keeping the aspect ratio unless told not to', () => {
    const body = '<rect width="100" height="50" fill="red"/>';
    const wide = 'viewBox="0 0 100 50"';
    expect(imported(svg(body, wide), { width: 200 })).toMatchObject({ width: 200, height: 100 });
    expect(imported(svg(body, wide), { height: 25 })).toMatchObject({ width: 50, height: 25 });
    expect(imported(svg(body, wide))).toMatchObject({ width: 100, height: 50 });
    // A square box: meet centres the content.
    expect(onlyShape(imported(svg(body, wide), { width: 100, height: 100 }))).toMatchObject({
      y: 25,
      height: 50,
    });
    expect(
      onlyShape(
        imported(svg(body, `${wide} preserveAspectRatio="xMaxYMax meet"`), {
          width: 100,
          height: 100,
        }),
      ),
    ).toMatchObject({ y: 50 });
    expect(
      onlyShape(
        imported(svg(body, `${wide} preserveAspectRatio="none"`), { width: 100, height: 100 }),
      ),
    ).toMatchObject({ y: 0, height: 100 });
    const sliced = imported(svg(body, `${wide} preserveAspectRatio="xMinYMin slice"`), {
      width: 100,
      height: 100,
    });
    expect(onlyShape(sliced)).toMatchObject({ x: 0, width: 200, height: 100 });
    expect(features(sliced)).toEqual(['clipping']);
  });

  it('scales by width and height without a viewBox, and uses 300 × 150 without either', () => {
    const body = '<rect width="10" height="10" fill="red"/>';
    expect(onlyShape(imported(svg(body, 'width="10" height="10"'), { width: 20 }))).toMatchObject({
      width: 20,
    });
    const bare = imported(svg(body, ''));
    expect(bare).toMatchObject({ width: 300, height: 150 });
    expect(onlyShape(bare)).toMatchObject({ width: 10 });
    expect(imported(svg(body, 'width="10"'), { height: 20 })).toMatchObject({ width: 20 });
    expect(imported(svg(body, 'width="10" height="0"'))).toMatchObject({ width: 10, height: 0 });
  });

  it('reports an unreadable viewBox and ignores it', () => {
    const value = imported(svg('<rect width="10" height="10" fill="red"/>', 'viewBox="0 0 0 10"'));
    expect(features(value)).toEqual(['viewBox']);
    expect(features(imported(svg('', 'viewBox="a b c d"')))).toEqual(['viewBox']);
  });

  it('reads a deferred preserveAspectRatio as the default', () => {
    const body = '<rect width="100" height="50" fill="red"/>';
    const value = imported(svg(body, 'viewBox="0 0 100 50" preserveAspectRatio="defer"'), {
      width: 100,
      height: 100,
    });
    expect(onlyShape(value)).toMatchObject({ y: 25 });
  });
});
