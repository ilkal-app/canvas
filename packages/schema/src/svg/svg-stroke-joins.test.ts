// Then: a stroked outline's `stroke-linejoin` is kept only where it turns a
// visible corner. Smooth curves (arcs, circles drawn as paths, rounded corners) have no corner
// to show a join, and a filled-only outline has no stroke to show one: neither carries a join, so
// they import as they did. Joins are drawn now, so none is reported.
import { describe, expect, it } from 'vitest';

import { importSvg } from './svg-import.js';

/**
 * The join fields and the join issue of some SVG's paths.
 *
 * @param body - The SVG's content.
 * @returns Each path's `strokeJoin`, and whether any join was reported.
 * @throws {Error} When the import is refused.
 */
function joinsOf(body: string): { joins: unknown[]; isReported: boolean } {
  const result = importSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`,
  );
  if (result.status !== 'imported') throw new Error(`refused: ${result.error}`);
  const joins = result.value.objects.flatMap((object) =>
    object.type === 'path' ? [object.strokeJoin] : [],
  );
  const isReported = result.value.issues.some(({ feature }) => feature === 'stroke-linejoin');
  return { joins, isReported };
}

describe('stroke-linejoin on import', () => {
  it('is left out for a filled-only outline', () => {
    expect(joinsOf('<path d="M0 0 L50 0 L50 50 Z" fill="red"/>')).toEqual({
      joins: [undefined],
      isReported: false,
    });
  });

  it('is left out for a stroked smooth curve: a circle drawn as a path, a stroked arc', () => {
    for (const d of [
      'M10 50 A40 40 0 1 0 90 50 A40 40 0 1 0 10 50 Z',
      'M10 50 A40 40 0 0 1 90 50',
      'M10 50 C10 20 40 10 50 10 S90 20 90 50',
    ]) {
      expect(joinsOf(`<path d="${d}" fill="none" stroke="red"/>`)).toEqual({
        joins: [undefined],
        isReported: false,
      });
    }
  });

  it('is left out where a line meets a curve along its tangent: a rounded corner', () => {
    expect(joinsOf('<path d="M10 0 H80 Q90 0 90 10 V60" fill="none" stroke="red"/>').joins).toEqual(
      [undefined],
    );
  });

  it('is kept, unreported, for a stroked polyline with a sharp corner: SVG’s miter by default', () => {
    expect(joinsOf('<polyline points="0 0 50 0 50 50" fill="none" stroke="red"/>')).toEqual({
      joins: ['miter'],
      isReported: false,
    });
    expect(
      joinsOf(
        '<polyline points="0 0 50 0 50 50" fill="none" stroke="red" stroke-linejoin="bevel"/>',
      ).joins,
    ).toEqual(['bevel']);
  });

  it('is kept at the corner a close makes, on each element', () => {
    expect(
      joinsOf('<path d="M10 50 A40 40 0 0 1 90 50 Z" fill="none" stroke="red"/>').joins,
    ).toEqual(['miter']);
    expect(
      joinsOf(
        '<polyline points="0 0 50 0 50 50" fill="none" stroke="red"/><path d="M0 60 L40 60 L40 90" fill="none" stroke="red"/>',
      ).joins,
    ).toEqual(['miter', 'miter']);
  });

  it('is kept where a closed one-piece curve meets its own start at an angle', () => {
    expect(
      joinsOf('<path d="M10 10 C80 10 80 80 10 10 Z" fill="none" stroke="red"/>').joins,
    ).toEqual(['miter']);
    expect(
      joinsOf('<path d="M10 50 C10 0 90 0 90 50 C90 100 10 100 10 50 Z" fill="none" stroke="red"/>')
        .joins,
    ).toEqual([undefined]);
  });

  it('is left out when the joins are round, the board’s default', () => {
    expect(
      joinsOf(
        '<polyline points="0 0 50 0 50 50" fill="none" stroke="red" stroke-linejoin="round"/>',
      ),
    ).toEqual({ joins: [undefined], isReported: false });
  });
});
