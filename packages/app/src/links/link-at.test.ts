// The link under a point: the topmost object the engine's exact
// hit finds there, never a covered one, nor one whose painted geometry misses the point.
import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { linkAtPoint } from './link-at.js';

/**
 * An engine whose board finds `ids` under every point, holding `objects`.
 *
 * @param ids - The hit ids, topmost first.
 * @param objects - The objects by id.
 * @returns The engine and its idsAt spy.
 */
function engineWith(
  ids: readonly string[],
  objects: Record<string, Partial<BoardObject> & { readonly link?: string }>,
): { readonly engine: MountedEngine; readonly idsAt: ReturnType<typeof vi.fn> } {
  const idsAt = vi.fn(() => ids as readonly ObjectId[]);
  const engine = {
    camera: () => ({ x: 0, y: 0, zoom: 2, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 }),
    board: {
      idsAt,
      board: { get: (id: ObjectId) => objects[id] as BoardObject | undefined },
    },
  } as unknown as MountedEngine;
  return { engine, idsAt };
}

/** A canvas whose box starts at (10, 20) on the page. */
const CANVAS = {
  getBoundingClientRect: () => ({ left: 10, top: 20 }),
} as unknown as Element;

describe('linkAtPoint', () => {
  it('asks the exact hit at the world point and the zoom, and gives the topmost link', () => {
    const { engine, idsAt } = engineWith(['top', 'below'], {
      top: { link: 'https://top.example/' },
      below: { link: 'https://below.example/' },
    });
    expect(linkAtPoint(engine, CANVAS, 110, 220)).toBe('https://top.example/');
    expect(idsAt).toHaveBeenCalledWith({ x: 50, y: 100 }, 2);
  });

  it('gives nothing when the topmost object has no link, even over a linked one', () => {
    const { engine } = engineWith(['cover', 'linked'], {
      cover: {},
      linked: { link: 'https://hidden.example/' },
    });
    expect(linkAtPoint(engine, CANVAS, 110, 220)).toBeUndefined();
  });

  it('gives nothing where nothing is drawn', () => {
    const { engine } = engineWith([], {});
    expect(linkAtPoint(engine, CANVAS, 110, 220)).toBeUndefined();
  });
});
