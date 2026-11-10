import { describe, expect, it } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';
import { SCHEMA_VERSION } from '@canvas/schema';

import { isTrustedStamp, snapshotDigest } from './snapshot-stamp.js';

const SNAPSHOT = new Uint8Array([1, 2, 3]);
const STAMP = {
  digest: snapshotDigest(SNAPSHOT),
  layoutVersion: DOCUMENT_LAYOUT_VERSION,
  schemaVersion: SCHEMA_VERSION,
};

describe('isTrustedStamp', () => {
  it('trusts a well-formed stamp for its own bytes', () => {
    expect(isTrustedStamp(STAMP, SNAPSHOT)).toBe(true);
  });

  for (const [name, stamp] of [
    ['a negative schema', { ...STAMP, schemaVersion: -1 }],
    ['a fractional schema', { ...STAMP, schemaVersion: SCHEMA_VERSION - 0.5 }],
    ['a negative layout', { ...STAMP, layoutVersion: -1 }],
    ['a fractional layout', { ...STAMP, layoutVersion: DOCUMENT_LAYOUT_VERSION - 0.5 }],
    ['inherited fields', Object.create(STAMP) as object],
  ] as const) {
    it(`refuses ${name}`, () => {
      expect(isTrustedStamp(stamp, SNAPSHOT)).toBe(false);
    });
  }
});
