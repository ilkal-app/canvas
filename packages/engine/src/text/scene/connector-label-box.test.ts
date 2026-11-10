import { describe, expect, it } from 'vitest';

import type { ConnectorObject, TextStyle } from '@canvas/schema';

import { connectorShapeFrom, placedConnector } from '../../connectors/connector-shape.js';
import { connectorObject, textObject } from '../../spatial/__fixtures__/spatial-objects.js';

import { CONNECTOR_LABEL_WRAP_WIDTH, hasOverflowingText } from './connector-label-box.js';
import { textOriginOf, textPlacementOf } from './text-placement.js';

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 14,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * A placed straight connector from (0, 0) to (200, 100), labelled.
 *
 * @param text - The label's text, or null for none.
 * @returns The connector.
 */
function labelled(text: string | null): ConnectorObject {
  const connector: ConnectorObject = {
    ...connectorObject('c'),
    label: text === null ? null : { text, runs: [{ length: text.length, style: STYLE }] },
  };
  const shape = connectorShapeFrom(
    connector,
    { point: { x: 0, y: 0 }, normal: null },
    { point: { x: 200, y: 100 }, normal: null },
  );
  return placedConnector(connector, shape);
}

describe('connector labels', () => {
  it('centres the label on the middle of the route, wrapping at a fixed width', () => {
    const placement = textPlacementOf(labelled('Yes'));
    expect(placement).toMatchObject({
      text: 'Yes',
      origin: { x: 100 - CONNECTOR_LABEL_WRAP_WIDTH / 2, y: 50 },
      wrapWidth: CONNECTOR_LABEL_WRAP_WIDTH,
      align: 'center',
      isOverflowAligned: true,
    });
    // As much above the middle as below it.
    if (!placement) throw new Error('no placement');
    expect(textOriginOf(placement, { height: 20 }).y).toBe(40);
  });

  it('draws no text without a label', () => {
    expect(textPlacementOf(labelled(null))).toBeUndefined();
  });

  it('publishes drawn bounds for shapes and connectors only', () => {
    expect(hasOverflowingText(labelled('x'))).toBe(true);
    expect(hasOverflowingText(textObject('t'))).toBe(false);
  });
});
