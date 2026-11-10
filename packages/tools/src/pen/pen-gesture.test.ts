// The pen's press, drag and Backspace as pure steps (the prototype's `PenMode`): what a
// press on a vertex does with and without a chain, a split that ends a chain, a join's drag
// through `setHandle`, Shift on a drag, and Backspace's three cases.
import { describe, expect, it } from 'vitest';

import { buildNetwork, countingIds } from './__fixtures__/networks.js';
import { NO_CHAIN, penBackspace, penDrag, penPress, type PenChain } from './pen-gesture.js';

const TOLERANCES = { vertex: 6, segment: 5 };
const ZERO = { x: 0, y: 0 };

/** a (0, 0) — b (100, 0) — c (200, 0), plus a lone d (300, 100). */
const chain = buildNetwork(
  [
    [0, 0],
    [100, 0],
    [200, 0],
    [300, 100],
  ],
  [
    [0, 1],
    [1, 2],
  ],
);
const [A = '', B = '', C = '', D = ''] = chain.ids;

/**
 * A chain ending at a vertex.
 *
 * @param vertexId - The vertex.
 * @returns The chain.
 */
function chainAt(vertexId: string): PenChain {
  return { vertexId, outHandle: ZERO };
}

describe('penPress', () => {
  it('does nothing on the chain’s own vertex, and ends the chain on a pair already joined', () => {
    const own = penPress(chain.network, chainAt(C), { x: 200, y: 0 }, TOLERANCES, countingIds());
    expect(own).toEqual({ network: chain.network, chain: chainAt(C), drag: undefined });
    const joined = penPress(chain.network, chainAt(C), { x: 100, y: 0 }, TOLERANCES, countingIds());
    expect(joined).toEqual({ network: chain.network, chain: NO_CHAIN, drag: undefined });
  });

  it('joins the chain to a vertex with a join drag, and starts a chain from one with none', () => {
    const join = penPress(chain.network, chainAt(D), { x: 1, y: 1 }, TOLERANCES, countingIds('j'));
    expect(join.drag).toMatchObject({ kind: 'join', vertexId: A, segmentId: 'j1' });
    const start = penPress(chain.network, NO_CHAIN, { x: 300, y: 100 }, TOLERANCES, countingIds());
    expect(start.chain).toEqual(chainAt(D));
    expect(start.drag).toMatchObject({ kind: 'place', isNew: false, segmentId: undefined });
  });

  it('splits a segment and, with a chain, joins the chain to the new vertex and ends it', () => {
    const step = penPress(chain.network, chainAt(D), { x: 50, y: 1 }, TOLERANCES, countingIds('s'));
    expect(step.network.vertices).toHaveLength(5);
    expect(step.network.segments).toHaveLength(4);
    expect(step.chain).toEqual(NO_CHAIN);
    expect(step.drag).toBeUndefined();
  });
});

describe('penDrag', () => {
  it('shapes a join’s arriving handle through setHandle, Alt breaking the mirror', () => {
    const join = penPress(chain.network, chainAt(D), { x: 0, y: 0 }, TOLERANCES, countingIds('j'));
    if (join.drag?.kind !== 'join') throw new Error('not a join');
    const shaped = penDrag(join.drag, join.chain, { x: 0, y: 30 }, false, true);
    expect(shaped.network.segments.at(-1)?.hb).toEqual({ x: 0, y: -30 });
    expect(shaped.chain).toEqual({ vertexId: D, outHandle: { x: 0, y: 30 } });
  });

  it('keeps a placed point’s handle on 45° steps with Shift', () => {
    const placed = penPress(chain.network, chainAt(C), { x: 400, y: 0 }, TOLERANCES, countingIds());
    if (placed.drag === undefined) throw new Error('no drag');
    const shaped = penDrag(placed.drag, placed.chain, { x: 440, y: 3 }, true, false);
    expect(shaped.chain.outHandle.y).toBeCloseTo(0, 9);
    expect(shaped.network.vertices.at(-1)?.mirror).toBe('both');
  });
});

describe('penBackspace', () => {
  it('does nothing without a chain, ends a chain at a junction, and steps back from an end', () => {
    expect(penBackspace(chain.network, NO_CHAIN)).toEqual({
      network: chain.network,
      chain: NO_CHAIN,
    });
    expect(penBackspace(chain.network, chainAt(B))).toEqual({
      network: chain.network,
      chain: NO_CHAIN,
    });
    const back = penBackspace(chain.network, chainAt(C));
    expect(back.chain).toEqual(chainAt(B));
    expect(back.network.vertices.map(({ id }) => id)).toEqual([A, B]);
    const lone = penBackspace(chain.network, chainAt(D));
    expect(lone.chain).toEqual(NO_CHAIN);
  });
});

describe('penDrag from a picked-up vertex', () => {
  it('pulls the outgoing handle and leaves the network as it was', () => {
    const start = penPress(chain.network, NO_CHAIN, { x: 300, y: 100 }, TOLERANCES, countingIds());
    if (start.drag === undefined) throw new Error('no drag');
    const shaped = penDrag(start.drag, start.chain, { x: 330, y: 100 }, false, false);
    expect(shaped.network.vertices).toBe(chain.network.vertices);
    expect(shaped.chain.outHandle).toEqual({ x: 30, y: 0 });
  });
});
