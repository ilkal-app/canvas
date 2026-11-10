// The inspector reads coordinates shared across selected text objects.
import { describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { commonStyleOfObjects, restyleTextObjects } from './text-restyle.js';

describe('object font variation reading', () => {
  const object = (id: string, fontVariations?: Record<string, number>) =>
    tenPointText(id, 'ab', {
      runs: [{ length: 2, style: { ...TEN, ...(fontVariations && { fontVariations }) } }],
    });

  it('reports shared coordinates across several objects regardless of key order', () => {
    expect(
      commonStyleOfObjects([
        object('a', { opsz: 18, wght: 700 }),
        object('b', { wght: 700, opsz: 18 }),
        object('c', { opsz: 18, wght: 700 }),
      ]).fontVariations,
    ).toEqual({ opsz: 18, wght: 700 });
  });

  it('leaves differing coordinates out as mixed', () => {
    expect(
      commonStyleOfObjects([object('a', { wght: 700 }), object('b', { wght: 600 })]),
    ).not.toHaveProperty('fontVariations');
    expect(commonStyleOfObjects([object('a', { wght: 700 }), object('b')])).not.toHaveProperty(
      'fontVariations',
    );
  });

  // None is spelt out as {} (shownTextStyle), so it differs from mixed (absent).
  it('reports no coordinates as {} when every object has none or an empty record', () => {
    expect(commonStyleOfObjects([object('a'), object('b', {})]).fontVariations).toEqual({});
  });

  it('measures merged runs and writes one style command for the selected objects', () => {
    const text = tenPointText('t', 'abcd', {
      runs: [
        { length: 2, style: { ...TEN, fontVariations: { opsz: 18 } } },
        { length: 2, style: { ...TEN, fontVariations: { opsz: 24 } } },
      ],
    });
    const measured: unknown[] = [];
    const { store, context, record } = createTextModeContext([text]);
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    restyleTextObjects(
      {
        ...context,
        layout: {
          layout: (input) => {
            measured.push(input.runs);
            return context.layout.layout(input);
          },
        },
      },
      ['t' as ObjectId],
      { fontVariationsAxes: { wght: 650 } },
    );
    const expected = [
      { length: 2, style: { ...TEN, fontVariations: { opsz: 18, wght: 650 } } },
      { length: 2, style: { ...TEN, fontVariations: { opsz: 24, wght: 650 } } },
    ];
    expect(measured).toContainEqual(expected);
    expect(store.get('t' as ObjectId)).toMatchObject({ runs: expected });
    expect(changes).toHaveLength(1);
    expect(record.capture).toEqual(['command']);
  });
});
