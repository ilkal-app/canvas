import { describe, expect, it } from 'vitest';

import * as publicText from '../index.js';

import { readVariationAxes } from './fvar.js';
import { normaliseVariations, VARIATION_STEP } from './normalise-variations.js';
import { variationKey } from './variation-key.js';

describe('@canvas/text variation exports', () => {
  it('exposes the same variation helpers and step as their modules', () => {
    expect(publicText.normaliseVariations).toBe(normaliseVariations);
    expect(publicText.variationKey).toBe(variationKey);
    expect(publicText.readVariationAxes).toBe(readVariationAxes);
    expect(publicText.VARIATION_STEP).toBe(VARIATION_STEP);
  });
});
