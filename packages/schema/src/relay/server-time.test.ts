import { describe, expect, it } from 'vitest';

import {
  encodeServerTime,
  encodeTimeRequest,
  MAX_TIME_REQUEST_ID,
  parseServerTime,
  parseTimeRequest,
} from './server-time.js';

describe('server time wire', () => {
  it('round trips a request and an answer', () => {
    expect(parseTimeRequest(encodeTimeRequest(0))).toBe(0);
    expect(parseTimeRequest(encodeTimeRequest(MAX_TIME_REQUEST_ID))).toBe(MAX_TIME_REQUEST_ID);
    expect(parseServerTime(encodeServerTime({ id: 7, nowMs: 1_770_000_000_123.9 }))).toEqual({
      id: 7,
      nowMs: 1_770_000_000_123,
    });
  });

  it('refuses to encode an id out of range', () => {
    for (const id of [-1, 1.5, MAX_TIME_REQUEST_ID + 1, Number.NaN])
      expect(() => encodeTimeRequest(id)).toThrow(RangeError);
  });

  it('reads anything else as not a request', () => {
    for (const payload of [
      'nope',
      'null',
      '[]',
      '{"type":"time-request"}',
      '{"type":"time-request","id":-1}',
      '{"type":"time-request","id":"1"}',
      '{"type":"time-request","id":1,"nowMs":5}',
      '{"type":"keepalive","id":1}',
    ])
      expect(parseTimeRequest(payload)).toBeUndefined();
  });

  it('reads anything else as not an answer', () => {
    for (const payload of [
      '{}',
      '{"type":"server-time","id":1}',
      '{"type":"server-time","id":1,"nowMs":-5}',
      '{"type":"server-time","id":1,"nowMs":1.5}',
      '{"type":"server-time","id":1,"nowMs":1e300}',
      '{"type":"server-time","id":1.5,"nowMs":5}',
      '{"type":"server-time","id":1,"nowMs":5,"x":1}',
      '{"type":"time-request","id":1,"nowMs":5}',
    ])
      expect(parseServerTime(payload)).toBeUndefined();
  });
});
