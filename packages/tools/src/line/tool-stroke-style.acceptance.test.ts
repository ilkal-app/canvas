import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { newLineObject } from './new-line-object.js';

const base = {
  stroke: { color: 'ink' as const, width: 2 },
  startCap: 'none' as const,
  endCap: 'none' as const,
  route: 'straight' as const,
};
const styled = {
  ...base,
  strokeDash: { pattern: [8, 8] },
  strokeJoin: 'miter' as const,
  strokeMiterLimit: 7,
  strokeCap: 'butt' as const,
};

describe('new line stroke style', () => {
  it('writes all set stroke options into the new line', () => {
    expect(
      newLineObject('l1' as ObjectId, { x: 10, y: 20 }, { x: 50, y: 20 }, styled),
    ).toMatchObject({
      strokeDash: { pattern: [8, 8] },
      strokeJoin: 'miter',
      strokeMiterLimit: 7,
      strokeCap: 'butt',
    });
  });

  it('omits every unset stroke option', () => {
    const line = newLineObject('l2' as ObjectId, { x: 0, y: 0 }, { x: 50, y: 0 }, base);
    for (const key of ['strokeDash', 'strokeJoin', 'strokeMiterLimit', 'strokeCap']) {
      expect(Object.hasOwn(line, key)).toBe(false);
    }
  });
});
