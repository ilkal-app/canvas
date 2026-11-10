import { describe, expect, it } from 'vitest';

import { DEFAULT_LINE_STYLE, lineToolStyleOf, toolStyleDefaults } from './line-style.js';

describe('the line tool’s style', () => {
  it('registers a plain straight line for the line tool', () => {
    expect(toolStyleDefaults).toEqual({ tool: 'line', style: DEFAULT_LINE_STYLE });
  });

  it('takes each field the tool style sets and the defaults for the rest', () => {
    expect(lineToolStyleOf(undefined)).toEqual(DEFAULT_LINE_STYLE);
    expect(lineToolStyleOf({ endCap: 'arrow', route: 'elbow' })).toEqual({
      ...DEFAULT_LINE_STYLE,
      endCap: 'arrow',
      route: 'elbow',
    });
  });

  it('draws straight for a route a line cannot take, and keeps its stroke for none', () => {
    expect(lineToolStyleOf({ route: 'curved', stroke: null })).toEqual(DEFAULT_LINE_STYLE);
  });
});
