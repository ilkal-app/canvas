import { describe, expect, it } from 'vitest';

import {
  connectorToolStyleOf,
  DEFAULT_CONNECTOR_STYLE,
  toolStyleDefaults,
} from './connector-style.js';

describe('the connector tool’s style', () => {
  it('registers a straight connector with an arrow at its end', () => {
    expect(toolStyleDefaults).toEqual({ tool: 'connector', style: DEFAULT_CONNECTOR_STYLE });
    expect(DEFAULT_CONNECTOR_STYLE).toMatchObject({ endCap: 'arrow', route: 'straight' });
  });

  it('takes each field the tool style sets, a curved route included, and defaults for the rest', () => {
    expect(connectorToolStyleOf(undefined)).toEqual(DEFAULT_CONNECTOR_STYLE);
    expect(connectorToolStyleOf({ startCap: 'circle', route: 'curved', stroke: null })).toEqual({
      ...DEFAULT_CONNECTOR_STYLE,
      startCap: 'circle',
      route: 'curved',
    });
  });
});
