import { describe, expect, it } from 'vitest';

import type { ConnectorObject } from '@canvas/schema';
import { measureObjectText, measuringFontsFor } from '@canvas/text';

import { covers } from '../paths/__fixtures__/mesh-coverage.js';
import { buildLineMesh } from '../paths/line-mesh.js';
import { COVER_VERTEX_COUNT } from '../paths/path-mesh.js';
import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { connectorMeshShapeOf } from './connector-mesh.js';

const LABEL: NonNullable<ConnectorObject['label']> = {
  text: 'Gap',
  runs: [
    {
      length: 3,
      style: { fontFamily: 'Inter', fontSize: 14, color: [0, 0, 0, 1], weight: 400, italic: false },
    },
  ],
};

/**
 * Returns only the drawn stroke triangles, excluding the stencil cover quad.
 *
 * @param connector - The connector to mesh.
 * @returns Its stroke triangles.
 */
function strokeOf(connector: ConnectorObject): Float32Array {
  const mesh = buildLineMesh({
    ...connectorMeshShapeOf(connector),
    strokeWidth: connector.stroke.width,
    tolerance: 0.25,
  });
  return mesh.vertices.subarray(COVER_VERTEX_COUNT * 2);
}

describe('connector stroke gap around its label', () => {
  const base = {
    ...connectorObject('gap'),
    to: { kind: 'point', x: 400, y: 0 } as const,
    startCap: 'circle' as const,
    endCap: 'circle' as const,
  };

  it('leaves the text box plus the padding on each side, keeping both true end caps', () => {
    const connector = { ...base, label: LABEL };
    const stroke = strokeOf(connector);
    // The text as laid out (not its 200-unit wrap box): the gap is its width and the padding a side.
    const measured = measureObjectText(connector, measuringFontsFor([LABEL.runs]).fonts)?.text;
    if (measured === undefined) throw new Error('The label was not measured.');
    const half = measured.width / 2;
    expect(covers(stroke, 200 - half - 2, 0)).toBe(false);
    expect(covers(stroke, 200, 0)).toBe(false);
    expect(covers(stroke, 200 + half + 2, 0)).toBe(false);
    expect(covers(stroke, 200 - half - 10, 0)).toBe(true);
    expect(covers(stroke, 200 + half + 10, 0)).toBe(true);
    for (const x of [0, 80, 320, 400]) expect(covers(stroke, x, 0)).toBe(true);
  });

  it('moves the gap with labelPosition, measured along the route', () => {
    const stroke = strokeOf({ ...base, label: LABEL, labelPosition: 0.25 });
    expect(covers(stroke, 100, 0)).toBe(false);
    expect(covers(stroke, 250, 0)).toBe(true);
    expect(covers(stroke, 400, 0)).toBe(true);
  });

  it('draws an unbroken stroke for null and empty labels', () => {
    for (const label of [null, { ...LABEL, text: '', runs: [] }]) {
      const stroke = strokeOf({ ...base, label });
      expect(covers(stroke, 200, 0)).toBe(true);
    }
  });
});
