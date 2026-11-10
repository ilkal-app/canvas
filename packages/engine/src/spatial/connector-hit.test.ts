import { describe, expect, it } from 'vitest';

import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import { connectorLabelSize, LABEL_GAP_PADDING } from '../connectors/connector-mesh.js';
import { FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';

import { connectorObject } from './__fixtures__/spatial-objects.js';
import { CONNECTOR_HIT_TOLERANCE_PX, hitPoint, hitTopmost } from './hit-point.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

const LABEL: NonNullable<ConnectorObject['label']> = {
  text: 'Pick me',
  runs: [
    {
      length: 7,
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

/** A 2-wide straight connector from (0, 0) to (300, 0). */
const LINE: ConnectorObject = {
  ...connectorObject('c'),
  to: { kind: 'point', x: 300, y: 0 },
  endCap: 'none',
};

function indexed(...objects: BoardObject[]) {
  const document = new FakeSceneDocument();
  document.create(...objects);
  const index = new SceneSpatialIndex();
  index.apply(document.takeChanges());
  return { index, document };
}

describe('picking a connector (item 5)', () => {
  it('hits a connector anywhere on its label, as drawn with the gap around it', () => {
    const labelled = { ...LINE, label: LABEL };
    const { index, document } = indexed(labelled);
    const size = connectorLabelSize(labelled);
    expect(size).toBeDefined();
    const halfHeight = (size?.height ?? 0) / 2 + LABEL_GAP_PADDING;
    const halfWidth = (size?.width ?? 0) / 2 + LABEL_GAP_PADDING;
    // Above the line's tolerance, inside the label's box.
    const above = { x: 150 + halfWidth - 1, y: halfHeight - 1 };
    expect(above.y).toBeGreaterThan(1 + CONNECTOR_HIT_TOLERANCE_PX);
    expect(hitPoint(index, document, above, { zoom: 1 })).toEqual(['c']);
    expect(hitTopmost(index, document, above, { zoom: 1 })).toBe('c');
    // The box grows by the pick tolerance too, as the line does.
    expect(
      hitPoint(
        index,
        document,
        { x: 150, y: halfHeight + CONNECTOR_HIT_TOLERANCE_PX - 1 },
        { zoom: 1 },
      ),
    ).toEqual(['c']);
    expect(
      hitPoint(
        index,
        document,
        { x: 150, y: halfHeight + CONNECTOR_HIT_TOLERANCE_PX + 1 },
        { zoom: 1 },
      ),
    ).toEqual([]);
    // Off the label's ends, only the line counts.
    expect(
      hitPoint(
        index,
        document,
        { x: 150 + halfWidth + CONNECTOR_HIT_TOLERANCE_PX + 1, y: halfHeight - 1 },
        { zoom: 1 },
      ),
    ).toEqual([]);
  });

  it('bounds a connector by its label, so the index finds a label past its route', () => {
    const { index } = indexed({ ...LINE, label: LABEL });
    const height = connectorLabelSize({ ...LINE, label: LABEL })?.height ?? 0;
    expect(index.boundsOf('c' as ObjectId)?.maxY).toBeGreaterThanOrEqual(height / 2);
  });

  it('has no label box without a label or with an empty one', () => {
    const empty = { ...LINE, label: { ...LABEL, text: '  ' } };
    const { index, document } = indexed(empty);
    expect(hitPoint(index, document, { x: 150, y: 12 }, { zoom: 1 })).toEqual([]);
  });

  it(`picks the line within ${String(CONNECTOR_HIT_TOLERANCE_PX)} screen px of its stroke, at any zoom`, () => {
    const { index, document } = indexed(LINE);
    const edge = 1 + CONNECTOR_HIT_TOLERANCE_PX;
    expect(hitPoint(index, document, { x: 60, y: edge - 0.5 }, { zoom: 1 })).toEqual(['c']);
    expect(hitPoint(index, document, { x: 60, y: edge + 0.5 }, { zoom: 1 })).toEqual([]);
    // At zoom 4 the tolerance is a quarter as many world units.
    const zoomed = 1 + CONNECTOR_HIT_TOLERANCE_PX / 4;
    expect(hitPoint(index, document, { x: 60, y: zoomed - 0.1 }, { zoom: 4 })).toEqual(['c']);
    expect(hitPoint(index, document, { x: 60, y: zoomed + 0.1 }, { zoom: 4 })).toEqual([]);
  });

  it('keeps an explicit tolerance exact: 0 is the stroke alone', () => {
    const { index, document } = indexed(LINE);
    expect(hitPoint(index, document, { x: 60, y: 0.9 }, { zoom: 1, tolerancePx: 0 })).toEqual([
      'c',
    ]);
    expect(hitPoint(index, document, { x: 60, y: 1.5 }, { zoom: 1, tolerancePx: 0 })).toEqual([]);
  });
});
