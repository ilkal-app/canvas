import { describe, expect, it } from 'vitest';

import { compareKeys } from '@canvas/document';
import { boardObjectSchema, createBoard, validateBoard } from '@canvas/schema';

import { createDemoBoard, DEMO_BOARD_LAYOUT } from './demo-board.js';

describe('createDemoBoard', () => {
  it('builds four sections of 70 rectangles, a few hundred objects', () => {
    const objects = createDemoBoard();
    expect(objects).toHaveLength(4 + 4 * 70);
    expect(objects.filter(({ type }) => type === 'frame')).toHaveLength(4);
  });

  it('builds valid objects that form a valid board', () => {
    const objects = createDemoBoard();
    for (const object of objects) expect(boardObjectSchema.parse(object)).toEqual(object);
    expect(validateBoard(createBoard(objects))).toEqual([]);
  });

  it('gives siblings distinct z keys, ordered as they are created', () => {
    const byParent = new Map<string | null, string[]>();
    for (const { parentId, z } of createDemoBoard()) {
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), z]);
    }
    expect(byParent.size).toBe(5);
    for (const keys of byParent.values()) {
      expect(new Set(keys).size).toBe(keys.length);
      expect([...keys].sort(compareKeys)).toEqual(keys);
    }
  });

  it('is the same board every time', () => {
    expect(createDemoBoard()).toEqual(createDemoBoard());
  });

  it('puts the first rectangle at world (50, 50), 70 × 60, in 8-bit-exact red', () => {
    const first = createDemoBoard().find(({ id }) => id === 'section-0-rect-0-0');
    expect(first).toMatchObject({ parentId: 'section-0', x: 10, y: 10, width: 70, height: 60 });
    expect(
      first?.type === 'shape' && Array.isArray(first.fill)
        ? first.fill.map((channel) => channel * 255)
        : [],
    ).toEqual([230, 57, 70, 255]);
  });

  it('spans (40, 40) to (1900, 1220): two 900 × 560 sections and a 60 gap each way', () => {
    const { origin } = DEMO_BOARD_LAYOUT;
    // The sections are the root objects, unrotated; every rectangle lies inside its section.
    const sections = createDemoBoard().flatMap((object) =>
      object.type === 'frame' && object.parentId === null ? [object] : [],
    );
    expect({
      minX: Math.min(...sections.map(({ x }) => x)),
      minY: Math.min(...sections.map(({ y }) => y)),
      maxX: Math.max(...sections.map(({ x, width }) => x + width)),
      maxY: Math.max(...sections.map(({ y, height }) => y + height)),
    }).toEqual({
      minX: origin.x,
      minY: origin.y,
      maxX: 1900,
      maxY: 1220,
    });
  });
});
