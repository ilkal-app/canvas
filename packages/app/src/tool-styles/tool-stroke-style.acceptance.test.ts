import { describe, expect, it } from 'vitest';

import type { StylePatch } from '@canvas/document';

import { connectorToolStyleOf, DEFAULT_CONNECTOR_STYLE } from './connector-style.js';
import { lineToolStyleOf, DEFAULT_LINE_STYLE } from './line-style.js';
import { penToolStyleOf, DEFAULT_PEN_STROKE } from './pen-style.js';

const strokeFields: StylePatch = {
  strokeDash: { pattern: [8, 8] },
  strokeJoin: 'miter',
  strokeMiterLimit: 12,
  strokeCap: 'square',
};

describe('stroke options forwarded to creation tools', () => {
  it('passes set fields through each tool adapter', () => {
    for (const adapter of [penToolStyleOf, lineToolStyleOf, connectorToolStyleOf]) {
      expect(adapter(strokeFields)).toMatchObject(strokeFields);
    }
  });

  it('omits absent fields and a null dash', () => {
    for (const adapter of [penToolStyleOf, lineToolStyleOf, connectorToolStyleOf]) {
      for (const source of [undefined, { strokeDash: null }]) {
        const result = adapter(source);
        for (const key of ['strokeDash', 'strokeJoin', 'strokeMiterLimit', 'strokeCap']) {
          expect(Object.hasOwn(result, key)).toBe(false);
        }
      }
    }
    expect(penToolStyleOf(undefined)).toMatchObject({ stroke: DEFAULT_PEN_STROKE, fill: null });
    expect(lineToolStyleOf(undefined)).toMatchObject(DEFAULT_LINE_STYLE);
    expect(connectorToolStyleOf(undefined)).toMatchObject(DEFAULT_CONNECTOR_STYLE);
  });
});
