// The inspector can distinguish no features from mixed features.
import { describe, expect, it } from 'vitest';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { shownTextStyle } from './runs/style-fields.js';
import { commonStyleOfObjects } from './text-restyle.js';

/**
 * A text object whose only run has the supplied optional feature record.
 *
 * @param id - The text object's id.
 * @param fontFeatures - Its optional feature record.
 * @returns The text object.
 */
function textWithFeatures(id: string, fontFeatures?: Record<string, number>) {
  return tenPointText(id, 'ab', {
    runs: [{ length: 2, style: { ...TEN, ...(fontFeatures && { fontFeatures }) } }],
  });
}

describe('features shown to the inspector', () => {
  it('shows a missing feature record explicitly as undefined', () => {
    expect(shownTextStyle(TEN)).toHaveProperty('fontFeatures', undefined);
    expect(shownTextStyle({ ...TEN, fontFeatures: { liga: 0 } })).toHaveProperty('fontFeatures', {
      liga: 0,
    });
  });

  it('reports a shared record, including unknown tags, across selected objects', () => {
    const objects = [
      textWithFeatures('a', { liga: 0, ss01: 1 }),
      textWithFeatures('b', { ss01: 1, liga: 0 }),
    ];
    const { store } = createTextModeContext(objects);
    expect(commonStyleOfObjects(objects).fontFeatures).toEqual({ liga: 0, ss01: 1 });
    expect(
      commonStyleOfObjects(objects.map((object) => store.get(object.id))).fontFeatures,
    ).toEqual({ liga: 0, ss01: 1 });
  });

  it('leaves the field out when selected runs disagree', () => {
    expect(
      commonStyleOfObjects([
        textWithFeatures('a', { liga: 0 }),
        textWithFeatures('b', { liga: 1 }),
      ]),
    ).not.toHaveProperty('fontFeatures');
    expect(
      commonStyleOfObjects([textWithFeatures('a'), textWithFeatures('b', { liga: 0 })]),
    ).not.toHaveProperty('fontFeatures');
  });

  it('keeps one selected object with no record distinct from mixed', () => {
    expect(commonStyleOfObjects([textWithFeatures('a')])).toHaveProperty('fontFeatures', undefined);
  });
});
