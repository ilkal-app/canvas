import { describe, expect, it } from 'vitest';

import { boardObjectSchema, createBoard, validateBoard } from '@canvas/schema';

import { createLargeBoardObjects } from './large-board.js';

describe('createLargeBoardObjects', () => {
  it('builds frames of 100 valid, consistent objects in the working-board mix', () => {
    const objects = createLargeBoardObjects(1_000, 7);
    expect(objects).toHaveLength(1_000);
    for (const object of objects) expect(boardObjectSchema.safeParse(object).success).toBe(true);
    expect(validateBoard(createBoard(objects))).toEqual([]);
    const frames = objects.filter(({ type }) => type === 'frame');
    expect(frames).toHaveLength(10);
    expect(frames.every(({ parentId }) => parentId === null)).toBe(true);
    const count = (type: string) => objects.filter((object) => object.type === type).length;
    expect([count('sticky'), count('shape'), count('connector')]).toEqual([270, 200, 140]);
  });

  it('builds the same board from the same seed, and other ids from another', () => {
    expect(createLargeBoardObjects(200, 3)).toEqual(createLargeBoardObjects(200, 3));
    expect(createLargeBoardObjects(200, 4)[0]?.id).not.toBe(createLargeBoardObjects(200, 3)[0]?.id);
  });
});
