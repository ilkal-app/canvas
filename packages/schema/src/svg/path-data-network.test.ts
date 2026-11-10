import { describe, expect, it } from 'vitest';

import { PATH_DATA_MAX_LENGTH, pathDataToNetwork } from './path-data-network.js';

const STROKED = { isFilled: false };
const FILLED = { isFilled: true };

describe('pathDataToNetwork', () => {
  it('reads path data in its own frame as written, nothing normalised', () => {
    const read = pathDataToNetwork('M10 20 L34 20', STROKED);
    expect(read).toMatchObject({
      isRead: true,
      vertices: [
        { id: 'v0', x: 10, y: 20, mirror: 'none' },
        { id: 'v1', x: 34, y: 20, mirror: 'none' },
      ],
      segments: [{ id: 's0', a: 'v0', b: 'v1' }],
      fillRule: undefined,
    });
  });

  it('leaves an open subpath open whatever the paint, and says when a fill is over one', () => {
    const stroked = pathDataToNetwork('M0 0 L10 0 L10 10', STROKED);
    expect(stroked).toMatchObject({ isRead: true, hasOpenUnderFill: false });
    expect(stroked.isRead && stroked.segments.length).toBe(2);
    const filled = pathDataToNetwork('M0 0 L10 0 L10 10', FILLED);
    expect(filled).toMatchObject({ isRead: true, hasOpenUnderFill: true });
    expect(filled.isRead && filled.segments.length).toBe(2);
    expect(pathDataToNetwork('M0 0 L10 0 L10 10 Z', FILLED)).toMatchObject({
      hasOpenUnderFill: false,
    });
  });

  it('checks the fill rule over the loops only', () => {
    // Two same-way squares, one left open: only the closed one is filled, so nothing differs.
    const read = pathDataToNetwork('M0 0 L20 0 L20 20 L0 20 Z M5 5 L15 5 L15 15 L5 15', FILLED);
    expect(read).toMatchObject({ isRead: true, fillRule: undefined, hasOpenUnderFill: true });
    expect(pathDataToNetwork('M0 0 L10 0', FILLED)).toMatchObject({ fillRule: undefined });
  });

  it('refuses malformed data with its offset, data drawing nothing and data over the cap', () => {
    expect(pathDataToNetwork('M0 0 X', STROKED)).toEqual({
      isRead: false,
      problem: 'path data: unexpected "X" at offset 5',
    });
    expect(pathDataToNetwork('M0 0 L0 0', STROKED)).toEqual({
      isRead: false,
      problem: 'the path data draws nothing',
    });
    const long = pathDataToNetwork(`M0 0 L1 1${' '.repeat(PATH_DATA_MAX_LENGTH)}`, STROKED);
    expect(!long.isRead && long.problem).toContain(String(PATH_DATA_MAX_LENGTH));
  });

  it('reports a fill nonzero would draw differently, and one too complex to check', () => {
    const nested = 'M0 0 L20 0 L20 20 L0 20 Z M5 5 L15 5 L15 15 L5 15 Z';
    const filled = pathDataToNetwork(nested, FILLED);
    expect(filled.isRead && filled.fillRule).toContain('even-odd, not nonzero');
    // Unfilled, the fill rule does not matter.
    expect(pathDataToNetwork(nested, STROKED)).toMatchObject({ fillRule: undefined });
    const points = Array.from({ length: 2_100 }, (unused, index) => {
      const angle = (index / 2_100) * 2 * Math.PI;
      return `L${(Math.cos(angle) * 100).toFixed(3)} ${(Math.sin(angle) * 100).toFixed(3)}`;
    });
    expect(pathDataToNetwork(`M100 0 ${points.join(' ')} Z`, FILLED)).toMatchObject({
      isRead: true,
      fillRule: 'too complex to check; nonzero is drawn even-odd',
    });
  });
});
