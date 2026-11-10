import { describe, expect, it } from 'vitest';

import type { FontMetrics } from '../font/font-metrics.js';

import { decodeFaceMetrics, encodeFaceMetrics } from './face-encoding.js';

const FACE = { family: 'Test', weight: 400, isItalic: false } as const;

const METRICS: FontMetrics = {
  face: FACE,
  ascent: 1854 / 2048,
  descent: 434 / 2048,
  missingAdvance: 1536 / 2048,
  advances: [
    [32, 569 / 2048],
    [33, 569 / 2048],
    [65, 1366 / 2048],
    [0x1f600, 2048 / 2048],
  ],
  kerning: [
    [65, 84, -152 / 2048],
    [65, 86, -135 / 2048],
    [84, 65, -152 / 2048],
  ],
};

describe('encodeFaceMetrics and decodeFaceMetrics', () => {
  it('round-trip a table exactly', () => {
    const encoded = encodeFaceMetrics(METRICS, 2048);
    expect(encoded).toBe('1kw;1fi;c2;16o;w:ft,ft|w:11y|2r3z:1kw;1t:2c=-48,2=-3r|j:1t=-48');
    expect(decodeFaceMetrics(FACE, encoded)).toEqual(METRICS);
  });

  it('round-trip a table without characters or kerning', () => {
    const empty: FontMetrics = { ...METRICS, advances: [], kerning: [] };
    expect(decodeFaceMetrics(FACE, encodeFaceMetrics(empty, 2048))).toEqual(empty);
  });

  it('refuse text that is not an encoded table', () => {
    expect(() => decodeFaceMetrics(FACE, '1kw;1ha')).toThrow(RangeError);
    expect(() => decodeFaceMetrics(FACE, '1kw;1ha;c2;1.5;;')).toThrow(/Bad number "1.5"/);
  });

  it('round-trips the decoration metrics a face gives, and leaves out those it does not', () => {
    const decorated: FontMetrics = {
      ...METRICS,
      underlinePosition: -150 / 2048,
      underlineThickness: 100 / 2048,
      strikeoutThickness: 102 / 2048,
      strikeoutPosition: 530 / 2048,
    };
    const encoded = encodeFaceMetrics(decorated, 2048);
    expect(encoded.split(';')).toHaveLength(7);
    expect(decodeFaceMetrics(FACE, encoded)).toEqual(decorated);
    const { strikeoutPosition, strikeoutThickness, ...underlineOnly } = decorated;
    expect(strikeoutPosition).toBeDefined();
    expect(strikeoutThickness).toBeDefined();
    expect(decodeFaceMetrics(FACE, encodeFaceMetrics(underlineOnly, 2048))).toEqual(underlineOnly);
    expect(encodeFaceMetrics(METRICS, 2048).split(';')).toHaveLength(6);
  });
});
