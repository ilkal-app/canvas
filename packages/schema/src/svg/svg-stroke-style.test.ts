// An imported stroke's dash, join and cap become the path's stroke style.
import { describe, expect, it } from 'vitest';

import { importSvg, type SvgImport } from './svg-import.js';

/**
 * Imports some SVG.
 *
 * @param body - The SVG's content, in a 100 × 100 viewBox.
 * @returns The import.
 * @throws {Error} When it is refused.
 */
function imported(body: string): SvgImport {
  const result = importSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`,
  );
  if (result.status !== 'imported') throw new Error(`refused: ${result.error}`);
  return result.value;
}

/**
 * The stroke style of the one stroked path an SVG imports as, and the features reported.
 *
 * @param body - The SVG's content.
 * @returns The path's style fields, and the issues' features.
 * @throws {Error} When it is not one stroked path.
 */
function styleOf(body: string): { style: Record<string, unknown>; features: string[] } {
  const value = imported(body);
  const [path] = value.objects;
  if (value.objects.length !== 1 || path?.type !== 'path') throw new Error('not one path');
  const { strokeDash, strokeJoin, strokeMiterLimit, strokeCap } = path;
  const style = Object.fromEntries(
    Object.entries({ strokeDash, strokeJoin, strokeMiterLimit, strokeCap }).filter(
      ([, field]) => field !== undefined,
    ),
  );
  return { style, features: value.issues.map(({ feature }) => feature) };
}

/**
 * An open polyline with a corner, stroked.
 *
 * @param extra - More attributes.
 * @returns The element.
 */
const OPEN = (extra: string): string =>
  `<polyline points="0 0 50 0 50 50" fill="none" stroke="red" ${extra}/>`;

describe('stroke-linecap', () => {
  it('maps butt (SVG’s default) and square, and leaves round out', () => {
    expect(styleOf(OPEN('stroke-linejoin="round"')).style).toEqual({ strokeCap: 'butt' });
    expect(styleOf(OPEN('stroke-linejoin="round" stroke-linecap="square"')).style).toEqual({
      strokeCap: 'square',
    });
    expect(styleOf(OPEN('stroke-linejoin="round" stroke-linecap="round"'))).toEqual({
      style: {},
      features: [],
    });
  });

  it('draws an unknown cap butt and reports it', () => {
    expect(styleOf(OPEN('stroke-linejoin="round" stroke-linecap="pointy"'))).toEqual({
      style: { strokeCap: 'butt' },
      features: ['stroke-linecap'],
    });
  });

  it('is left out on a closed outline, where no end shows', () => {
    expect(
      styleOf('<path d="M0 0 L50 0 L50 50 Z" fill="none" stroke="red" stroke-linejoin="round"/>')
        .style,
    ).toEqual({});
  });
});

describe('stroke-linejoin and stroke-miterlimit', () => {
  const roundCaps = 'stroke-linecap="round"';

  it('keeps a miter limit other than 4, capped at 100', () => {
    expect(styleOf(OPEN(`${roundCaps} stroke-miterlimit="10"`)).style).toEqual({
      strokeJoin: 'miter',
      strokeMiterLimit: 10,
    });
    expect(styleOf(OPEN(`${roundCaps} stroke-miterlimit="4"`)).style).toEqual({
      strokeJoin: 'miter',
    });
    expect(styleOf(OPEN(`${roundCaps} stroke-miterlimit="500"`))).toEqual({
      style: { strokeJoin: 'miter', strokeMiterLimit: 100 },
      features: ['stroke-miterlimit'],
    });
  });

  it('draws miter-clip and arcs as miters and reports them, and an unknown join too', () => {
    for (const join of ['miter-clip', 'arcs', 'wobbly']) {
      expect(styleOf(OPEN(`${roundCaps} stroke-linejoin="${join}"`))).toEqual({
        style: { strokeJoin: 'miter' },
        features: ['stroke-linejoin'],
      });
    }
  });

  it('leaves bevel’s miter limit out', () => {
    expect(
      styleOf(OPEN(`${roundCaps} stroke-linejoin="bevel" stroke-miterlimit="9"`)).style,
    ).toEqual({ strokeJoin: 'bevel' });
  });
});

describe('stroke-dasharray and stroke-dashoffset', () => {
  const plain = 'stroke-linecap="round" stroke-linejoin="round"';
  const line = (extra: string): string => `<path d="M0 0 L90 0" stroke="red" ${plain} ${extra}/>`;

  it('maps the lengths and offset, scaled with the stroke', () => {
    expect(styleOf(line('stroke-dasharray="4, 2" stroke-dashoffset="1"')).style).toEqual({
      strokeDash: { pattern: [4, 2], offset: 1 },
    });
    expect(
      styleOf(`<g transform="scale(2)">${line('stroke-dasharray="4px 2px"')}</g>`).style,
    ).toEqual({ strokeDash: { pattern: [8, 4] } });
    expect(
      styleOf(line('stroke-dasharray="4 2" vector-effect="non-scaling-stroke"')).style,
    ).toEqual({ strokeDash: { pattern: [4, 2] } });
  });

  it('keeps the offset within half a period of 0, an odd pattern’s period doubled', () => {
    // Period 6: 5 is −1; −7 is −1.
    expect(styleOf(line('stroke-dasharray="4 2" stroke-dashoffset="5"')).style).toEqual({
      strokeDash: { pattern: [4, 2], offset: -1 },
    });
    expect(styleOf(line('stroke-dasharray="4 2" stroke-dashoffset="-7"')).style).toEqual({
      strokeDash: { pattern: [4, 2], offset: -1 },
    });
    // Odd: [3] is 3 on, 3 off, a period of 6; 6 is 0.
    expect(styleOf(line('stroke-dasharray="3" stroke-dashoffset="6"')).style).toEqual({
      strokeDash: { pattern: [3] },
    });
  });

  it('draws solid, unreported, what SVG draws solid', () => {
    for (const dashes of ['none', '0 0', '4 -2']) {
      expect(styleOf(line(`stroke-dasharray="${dashes}"`))).toEqual({ style: {}, features: [] });
    }
  });

  it('draws solid and reports what the board cannot hold', () => {
    for (const dashes of ['10% 5%', '1 2 3 4 5 6 7 8 9', '5000 1', 'dashed']) {
      expect(styleOf(line(`stroke-dasharray="${dashes}"`))).toEqual({
        style: {},
        features: ['stroke-dasharray'],
      });
    }
  });

  it('reports an offset not in user units and starts the pattern at 0', () => {
    expect(styleOf(line('stroke-dasharray="4 2" stroke-dashoffset="1em"'))).toEqual({
      style: { strokeDash: { pattern: [4, 2] } },
      features: ['stroke-dashoffset'],
    });
  });
});

describe('shape or path', () => {
  it('draws a dashed rectangle as a path carrying the dash', () => {
    const value = imported(
      '<rect width="10" height="10" fill="none" stroke="red" stroke-dasharray="2 2"/>',
    );
    expect(value.objects.map((object) => object.type)).toEqual(['path']);
    expect(value.objects[0]).toMatchObject({
      strokeDash: { pattern: [2, 2] },
      strokeJoin: 'miter',
    });
  });

  it('draws a mitred rectangle as a shape, and a bevelled or rounded one as a path', () => {
    const shape = imported('<rect width="10" height="10" fill="none" stroke="red"/>');
    expect(shape.objects.map((object) => object.type)).toEqual(['shape']);
    const bevel = imported(
      '<rect width="10" height="10" fill="none" stroke="red" stroke-linejoin="bevel"/>',
    );
    expect(bevel.objects).toMatchObject([{ type: 'path', strokeJoin: 'bevel' }]);
    const round = imported(
      '<rect width="10" height="10" fill="none" stroke="red" stroke-linejoin="round"/>',
    );
    expect(round.objects).toMatchObject([{ type: 'path' }]);
    expect(round.objects[0]).not.toHaveProperty('strokeJoin');
  });

  it('puts the stroke style on the stroke of a filled open outline, not on its fill', () => {
    const value = imported(
      '<path d="M0 0 L50 0 L50 50" fill="blue" stroke="red" stroke-dasharray="3 1"/>',
    );
    expect(value.objects).toMatchObject([
      { type: 'path', stroke: null },
      { type: 'path', strokeDash: { pattern: [3, 1] }, strokeCap: 'butt', strokeJoin: 'miter' },
    ]);
    expect(value.objects[0]).not.toHaveProperty('strokeDash');
  });
});
