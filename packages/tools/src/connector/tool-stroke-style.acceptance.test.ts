import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { connectInputOf, newConnectorObject } from './new-connector.js';

const from = { kind: 'point' as const, point: { x: 10, y: 20 }, guides: [] };
const to = { kind: 'point' as const, point: { x: 50, y: 20 }, guides: [] };
const base = {
  stroke: { color: 'ink' as const, width: 2 },
  startCap: 'none' as const,
  endCap: 'arrow' as const,
  route: 'straight' as const,
};
const styled = {
  ...base,
  strokeDash: { pattern: [8, 8] },
  strokeJoin: 'bevel' as const,
  strokeMiterLimit: 6,
  strokeCap: 'square' as const,
};

describe('new connector stroke style', () => {
  it('writes set options into both the command input and preview object', () => {
    for (const connector of [
      connectInputOf('c1' as ObjectId, from, to, styled),
      newConnectorObject('c1' as ObjectId, from, to, styled),
    ]) {
      expect(connector).toMatchObject({
        strokeDash: { pattern: [8, 8] },
        strokeJoin: 'bevel',
        strokeMiterLimit: 6,
        strokeCap: 'square',
      });
    }
  });

  it('omits unset options from both representations', () => {
    for (const connector of [
      connectInputOf('c2' as ObjectId, from, to, base),
      newConnectorObject('c2' as ObjectId, from, to, base),
    ]) {
      for (const key of ['strokeDash', 'strokeJoin', 'strokeMiterLimit', 'strokeCap']) {
        expect(Object.hasOwn(connector, key)).toBe(false);
      }
    }
  });
});
