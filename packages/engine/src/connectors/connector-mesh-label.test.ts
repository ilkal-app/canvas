import { describe, expect, it } from 'vitest';

import type { ConnectorObject } from '@canvas/schema';

import { connectorObject } from '../spatial/__fixtures__/spatial-objects.js';

import { connectorLabelSize, isSameConnectorMesh } from './connector-mesh.js';

const LABEL: NonNullable<ConnectorObject['label']> = {
  text: 'Gap',
  runs: [
    {
      length: 3,
      style: {
        fontFamily: 'Liberation Sans',
        fontSize: 14,
        color: [0, 0, 0, 1],
        weight: 400,
        italic: false,
      },
    },
  ],
};

describe('connector label meshes', () => {
  const base: ConnectorObject = { ...connectorObject('m'), label: LABEL };

  it('measures a label once, by its object', () => {
    const first = connectorLabelSize(base);
    expect(first?.width).toBeGreaterThan(0);
    expect(connectorLabelSize({ ...base })).toBe(first);
  });

  it('rebuilds the mesh when the label or its position changes, not for a copy of it', () => {
    expect(isSameConnectorMesh(base, { ...base })).toBe(true);
    expect(isSameConnectorMesh(base, { ...base, label: { ...LABEL } })).toBe(true);
    expect(isSameConnectorMesh(base, { ...base, label: { ...LABEL, text: 'Gaps' } })).toBe(false);
    expect(isSameConnectorMesh(base, { ...base, labelPosition: 0.25 })).toBe(false);
  });
});
