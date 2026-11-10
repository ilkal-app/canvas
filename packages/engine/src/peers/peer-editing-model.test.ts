import { describe, expect, it } from 'vitest';

import {
  EMPTY_PEER_EDITING,
  isPeerEditingModel,
  PEER_HIGHLIGHT_ALPHA,
  peerEditingRectsOf,
  type PeerEditingMark,
  type PeerEditingModel,
} from './peer-editing-model.js';

const MARK: PeerEditingMark = {
  box: { x: 10, y: 20, width: 100, height: 50, rotation: 0 },
  color: [1, 0, 0, 1],
  caret: { x: 30, y: 30, width: 0, height: 16, rotation: 0 },
  highlights: [],
};

describe('isPeerEditingModel', () => {
  it('accepts the empty model and well-formed peers', () => {
    expect(isPeerEditingModel(EMPTY_PEER_EDITING)).toBe(true);
    expect(isPeerEditingModel({ peers: [MARK] })).toBe(true);
  });

  it.each([
    null,
    'peers',
    {},
    { peers: 'no' },
    { peers: [null] },
    { peers: [{ ...MARK, box: { ...MARK.box, x: Number.NaN } }] },
    { peers: [{ ...MARK, box: { ...MARK.box, width: -1 } }] },
    { peers: [{ ...MARK, caret: { ...MARK.caret, height: -1 } }] },
    { peers: [{ ...MARK, caret: null }] },
    { peers: [{ ...MARK, highlights: [{ x: 0 }] }] },
    { peers: [{ ...MARK, highlights: 'none' }] },
    { peers: [{ ...MARK, color: [1, 0, 0] }] },
    { peers: [{ ...MARK, color: [1, 0, 0, '1'] }] },
    { peers: [{ ...MARK, color: '#ff0000' }] },
  ])('refuses %j', (value) => {
    expect(isPeerEditingModel(value)).toBe(false);
  });
});

describe('peerEditingRectsOf', () => {
  it('draws nothing for no peer', () => {
    expect(peerEditingRectsOf(EMPTY_PEER_EDITING, 1)).toEqual([]);
  });

  it('outlines the box just outside it and centres a 2 px caret, at 100%', () => {
    const rects = peerEditingRectsOf({ peers: [MARK] }, 1);
    expect(rects).toHaveLength(5);
    const [top, bottom, left, right, caret] = rects;
    expect(top).toMatchObject({ x: 8, y: 18, width: 104, height: 2, cos: 1, sin: 0 });
    expect(bottom).toMatchObject({ x: 8, y: 70, width: 104, height: 2 });
    expect(left).toMatchObject({ x: 8, y: 20, width: 2, height: 50 });
    expect(right).toMatchObject({ x: 110, y: 20, width: 2, height: 50 });
    expect(caret).toMatchObject({ x: 29, y: 30, width: 2, height: 16, color: [1, 0, 0, 1] });
  });

  it('keeps screen widths at any zoom and pixel ratio, at least one device pixel', () => {
    const [top, , , , caret] = peerEditingRectsOf({ peers: [MARK] }, 4, 2);
    expect(top?.height).toBeCloseTo(3 / 2 / 4);
    expect(caret?.width).toBeCloseTo(2 / 4);
    const [thin] = peerEditingRectsOf({ peers: [MARK] }, 1, 0.5);
    expect(thin?.height).toBe(2);
  });

  it('highlights each span under the outline, translucent, and turns everything with its box', () => {
    const turned: PeerEditingModel = {
      peers: [
        {
          ...MARK,
          box: { ...MARK.box, rotation: Math.PI / 2 },
          highlights: [{ x: 5, y: 6, width: 20, height: 10, rotation: Math.PI / 2 }],
        },
      ],
    };
    const [highlight, top] = peerEditingRectsOf(turned, 1);
    expect(highlight).toMatchObject({ x: 5, y: 6, width: 20, height: 10 });
    expect(highlight?.color).toEqual([1, 0, 0, PEER_HIGHLIGHT_ALPHA]);
    expect(highlight?.cos).toBeCloseTo(0);
    expect(highlight?.sin).toBeCloseTo(1);
    // The top band's corner (-2, -2) in the box's frame, turned a quarter: (2, -2) from (10, 20).
    expect(top?.x).toBeCloseTo(12);
    expect(top?.y).toBeCloseTo(18);
  });

  it('does not change its input', () => {
    const model: PeerEditingModel = { peers: [MARK] };
    const copy = structuredClone(model);
    peerEditingRectsOf(model, 2);
    expect(model).toEqual(copy);
  });
});
