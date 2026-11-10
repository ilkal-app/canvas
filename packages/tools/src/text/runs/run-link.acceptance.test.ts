// Written before the code. CONTRACT: clipboard run links survive when valid and are removed when unsafe. Deliberately not asserted: browser clipboard UI.
import { describe, expect, it } from 'vitest';

import { BASE, runsOf } from './__fixtures__/text-styles.js';
import { parseRunsPayload, serializeRunsPayload } from './runs-payload.js';
import { TEXT_STYLE_FIELDS } from './style-fields.js';

const LINK = 'https://example.com/range';

describe('run link clipboard payload', () => {
  it('lists link among text style fields and preserves a copied linked run', () => {
    expect(TEXT_STYLE_FIELDS).toContain('link');
    const payload = { text: 'Hi', runs: runsOf([2, { ...BASE, link: LINK }]) };
    expect(parseRunsPayload(serializeRunsPayload(payload))).toEqual(payload);
  });

  it.each(['javascript:alert(1)', 'https://user:pass@example.com/', ' https://example.com/ '])(
    'drops unsafe pasted link %j and keeps other style',
    (link) => {
      const json = JSON.stringify({
        text: 'Hi',
        runs: [{ length: 2, style: { ...BASE, weight: 700, link } }],
      });
      expect(parseRunsPayload(json)).toEqual({
        text: 'Hi',
        runs: runsOf([2, { ...BASE, weight: 700 }]),
      });
    },
  );
});
