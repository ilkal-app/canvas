import { describe, expect, it } from 'vitest';

import { BASE, runsOf } from './__fixtures__/text-styles.js';
import { parseRunsPayload, serializeRunsPayload } from './runs-payload.js';

describe('font features runs clipboard payload', () => {
  it('preserves a valid feature record', () => {
    const payload = {
      text: 'Hi',
      runs: runsOf([2, { ...BASE, fontFeatures: { liga: 0, tnum: 1 } }]),
    };
    expect(parseRunsPayload(serializeRunsPayload(payload))).toEqual(payload);
  });

  it('drops a malformed record without dropping the run', () => {
    for (const fontFeatures of [{ liga: -1 }, { lig: 1 }, { liga: 0.5 }, { liga: 65536 }]) {
      const json = JSON.stringify({
        text: 'Hi',
        runs: [{ length: 2, style: { ...BASE, fontFeatures } }],
      });
      expect(parseRunsPayload(json)).toEqual({ text: 'Hi', runs: runsOf([2, BASE]) });
    }
  });
});
