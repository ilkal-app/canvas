// Live cursors' pure parts (item 10): which peers have a cursor on the page shown, the
// easing toward a peer's latest position, and the pointer's board position.
import { describe, expect, it } from 'vitest';

import {
  colorForPrincipal,
  colourwayForPrincipal,
  type PresenceSnapshot,
  type PresenceState,
} from '@canvas/collab';

import { CURSOR_EASE_MS, cursorPointOf, easeCursor, peerCursorsOf } from './peer-cursors-model.js';

const CAMERA = { x: -100, y: 50, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * A peer's presence.
 *
 * @param id - The principal id, also the name.
 * @param fields - The rest.
 * @returns The state.
 */
function peer(id: string, fields: Partial<PresenceState> = {}): PresenceState {
  return {
    principal: { id, kind: 'user', name: id.toUpperCase(), color: '#3366cc' },
    updatedAt: 0,
    ...fields,
  };
}

describe('peerCursorsOf', () => {
  it('lists the peers with a cursor on the page shown, a page-less peer on the first page', () => {
    const snapshot: PresenceSnapshot = new Map([
      [1, peer('mira', { cursor: { x: 10, y: 20 }, page: 'p2' })],
      [2, peer('jonas', { cursor: { x: 1, y: 2 } })],
      [3, peer('bea', { page: 'p2' })],
      [4, peer('kai', { cursor: { x: 5, y: 5 }, page: 'p1' })],
    ]);
    expect(peerCursorsOf(snapshot, 'p2', 'p1')).toEqual([
      {
        clientId: 1,
        principalId: 'mira',
        name: 'MIRA',
        // The colour her client sent is ignored: her colourway's dark, from her id.
        color: colorForPrincipal('mira'),
        colourway: colourwayForPrincipal('mira'),
        isAgent: false,
        point: { x: 10, y: 20 },
      },
    ]);
    expect(peerCursorsOf(snapshot, 'p1', 'p1').map((cursor) => cursor.clientId)).toEqual([2, 4]);
  });

  it('draws a peer in their principal’s colourway, the one every client gives them', () => {
    const snapshot: PresenceSnapshot = new Map([
      [1, peer('mira', { cursor: { x: 0, y: 0 } })],
      [2, peer('mira', { cursor: { x: 9, y: 9 } })],
    ]);
    const [first, second] = peerCursorsOf(snapshot, 'p1', 'p1');
    expect(first?.colourway).toBe(colourwayForPrincipal('mira'));
    expect(second?.colourway).toBe(first?.colourway);
  });

  it('marks an agent, and nobody else', () => {
    const agent = peer('layout', { cursor: { x: 0, y: 0 } });
    const snapshot: PresenceSnapshot = new Map([
      [1, { ...agent, principal: { ...agent.principal, kind: 'agent' } }],
      [2, peer('guest', { cursor: { x: 0, y: 0 } })],
    ]);
    expect(peerCursorsOf(snapshot, 'p1', 'p1').map((cursor) => cursor.isAgent)).toEqual([
      true,
      false,
    ]);
  });

  it('lists nobody on an empty board', () => {
    expect(peerCursorsOf(new Map(), 'p1', 'p1')).toEqual([]);
  });
});

describe('easeCursor', () => {
  it('closes the same share of the gap whatever the frame rate', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 0 };
    const once = easeCursor(from, to, 32, 1);
    const twice = easeCursor(easeCursor(from, to, 16, 1), to, 16, 1);
    expect(once.x).toBeCloseTo(twice.x, 9);
    expect(once.x).toBeCloseTo(100 * (1 - Math.exp(-32 / CURSOR_EASE_MS)), 9);
  });

  it('lands on the target once within a quarter pixel at the zoom', () => {
    const to = { x: 10, y: 10 };
    expect(easeCursor({ x: 10.1, y: 10 }, to, 16, 1)).toBe(to);
    expect(easeCursor({ x: 10.1, y: 10 }, to, 16, 8)).not.toBe(to);
  });

  it('stays put for no time, or time running backwards', () => {
    expect(easeCursor({ x: 0, y: 0 }, { x: 50, y: 50 }, -5, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe('cursorPointOf', () => {
  it('maps a point on the canvas to the board', () => {
    expect(cursorPointOf(CAMERA, { x: 200, y: 100 })).toEqual({ x: 0, y: 100 });
    expect(cursorPointOf(CAMERA, { x: 800, y: 600 })).toEqual({ x: 300, y: 350 });
  });

  it('has no board point off the canvas', () => {
    expect(cursorPointOf(CAMERA, { x: -1, y: 10 })).toBeNull();
    expect(cursorPointOf(CAMERA, { x: 10, y: 601 })).toBeNull();
  });
});
