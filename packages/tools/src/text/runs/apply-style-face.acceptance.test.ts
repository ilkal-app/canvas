import { describe, expect, it } from 'vitest';

import { BASE, runsOf } from './__fixtures__/text-styles.js';
import { commonStyle } from './apply-style.js';
import { TEXT_STYLE_FIELDS } from './style-fields.js';

describe('shared named face', () => {
  it('lists the face among fields the inspector can share', () => {
    expect(TEXT_STYLE_FIELDS).toContain('postScriptName');
  });

  it('spells out no face for a plain range and its caret', () => {
    const runs = runsOf([4, BASE]);
    expect(commonStyle(runs, 0, 4)).toHaveProperty('postScriptName', undefined);
    expect(commonStyle(runs, 2, 2)).toHaveProperty('postScriptName', undefined);
  });

  it('keeps one shared face and leaves a mixed face out', () => {
    const named = { ...BASE, postScriptName: 'PrivateSans-Condensed' };
    const shared = runsOf([2, named], [2, { ...named, fontSize: 30 }]);
    expect(commonStyle(shared, 0, 4)).toHaveProperty('postScriptName', 'PrivateSans-Condensed');
    const mixed = runsOf([2, named], [2, BASE]);
    expect(commonStyle(mixed, 0, 4)).not.toHaveProperty('postScriptName');
  });
});
