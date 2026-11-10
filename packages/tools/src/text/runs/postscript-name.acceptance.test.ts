import { describe, expect, it } from 'vitest';

import { BASE, runsOf } from './__fixtures__/text-styles.js';
import { parseRunsPayload, serializeRunsPayload } from './runs-payload.js';

describe('PostScript name runs clipboard payload', () => {
  it('round trips a selected face', () => {
    const faceStyle = { ...BASE, postScriptName: 'InterDisplay-Regular' };
    const payload = {
      text: 'Hi',
      runs: runsOf([2, faceStyle]),
    };
    expect(parseRunsPayload(serializeRunsPayload(payload))).toEqual(payload);
  });

  it('drops malformed face names without dropping the run', () => {
    for (const postScriptName of ['', 'Inter Display', 'Inter/Display', 'Café']) {
      const json = JSON.stringify({
        text: 'Hi',
        runs: [{ length: 2, style: { ...BASE, postScriptName } }],
      });
      expect(parseRunsPayload(json)).toEqual({ text: 'Hi', runs: runsOf([2, BASE]) });
    }
  });
});
