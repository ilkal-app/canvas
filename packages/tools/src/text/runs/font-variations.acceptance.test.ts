// Variation coordinates must survive the run-style reading path.
import { describe, expect, it } from 'vitest';

import { BASE, runsOf } from './__fixtures__/text-styles.js';
import { applyStyle, commonStyle } from './apply-style.js';
import { TEXT_STYLE_FIELDS } from './style-fields.js';

describe('run font variation reading', () => {
  it('lists font variations among the fields the inspector reads', () => {
    expect(TEXT_STYLE_FIELDS).toContain('fontVariations');
  });

  it('reports shared coordinates regardless of axis key order', () => {
    const runs = runsOf(
      [2, { ...BASE, fontVariations: { opsz: 18, wght: 700 } }],
      [2, { ...BASE, fontVariations: { wght: 700, opsz: 18 } }],
    );
    expect(commonStyle(runs, 0, 4).fontVariations).toEqual({ opsz: 18, wght: 700 });
  });

  it('leaves differing coordinates out as mixed', () => {
    const runs = runsOf(
      [2, { ...BASE, fontVariations: { wght: 700 } }],
      [2, { ...BASE, fontVariations: { wght: 600 } }],
    );
    expect(commonStyle(runs, 0, 4)).not.toHaveProperty('fontVariations');
  });

  // None is spelt out as {} (shownTextStyle), so it differs from mixed (absent), as the panel
  // spells out no letter-spacing and an auto line-height.
  it('reports no coordinates as {} when every run has none or an empty record', () => {
    const runs = runsOf([2, BASE], [2, { ...BASE, fontVariations: {} }]);
    expect(commonStyle(runs, 0, 4).fontVariations).toEqual({});
    expect(commonStyle(runsOf([2, BASE]), 0, 2).fontVariations).toEqual({});
    expect(commonStyle(runsOf([2, { ...BASE, fontVariations: {} }]), 0, 2).fontVariations).toEqual(
      {},
    );
  });

  it('replaces the whole coordinate record on the selected range', () => {
    const original = { ...BASE, fontVariations: { opsz: 18, wght: 500 } };
    const runs = applyStyle(runsOf([6, original]), 2, 4, { fontVariations: { wght: 700 } });
    expect(runs).toEqual(
      runsOf([2, original], [2, { ...BASE, fontVariations: { wght: 700 } }], [2, original]),
    );
  });

  it('preserves each run’s optical size when Bold changes only weight', () => {
    const first = { ...BASE, fontVariations: { opsz: 18 } };
    const second = { ...BASE, fontVariations: { opsz: 24 } };
    const runs = applyStyle(runsOf([2, first], [2, second]), 0, 4, { weight: 700 });
    expect(runs).toEqual(runsOf([2, { ...first, weight: 700 }], [2, { ...second, weight: 700 }]));
  });

  it('merges one axis into each run and removes only the requested axis', () => {
    const first = { ...BASE, fontVariations: { opsz: 18 } };
    const second = { ...BASE, fontVariations: { opsz: 24 } };
    const original = runsOf([2, first], [2, second]);
    const merged = applyStyle(original, 0, 4, { fontVariationsAxes: { wght: 650 } });
    expect(merged).toEqual(
      runsOf(
        [2, { ...first, fontVariations: { opsz: 18, wght: 650 } }],
        [2, { ...second, fontVariations: { opsz: 24, wght: 650 } }],
      ),
    );
    expect(original).toEqual(runsOf([2, first], [2, second]));
    expect(applyStyle(merged, 0, 4, { fontVariationsAxes: { opsz: null } })).toEqual(
      runsOf([4, { ...BASE, fontVariations: { wght: 650 } }]),
    );
    expect(
      applyStyle(runsOf([2, { ...BASE, fontVariations: { opsz: 18 } }]), 0, 2, {
        fontVariationsAxes: { opsz: null },
      })[0]?.style,
    ).not.toHaveProperty('fontVariations');
  });

  it('gives the whole-record patch precedence when both forms are supplied', () => {
    const style = applyStyle(runsOf([2, { ...BASE, fontVariations: { opsz: 18 } }]), 0, 2, {
      fontVariations: { wght: 700 },
      fontVariationsAxes: { opsz: 24 },
    })[0]?.style;
    expect(style?.fontVariations).toEqual({ wght: 700 });
    expect(style).not.toHaveProperty('fontVariationsAxes');
  });
});
