import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import {
  OLD_BUILD,
  oldBuildOn,
  relayHolding,
  updateOf,
} from './__fixtures__/stamp-check-fixtures.js';
import {
  createDocumentMeta,
  DOCUMENT_LAYOUT_VERSION,
  DOCUMENT_META_KEY,
  META_MAP_NAME,
} from './document-meta.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The stamps the relay refuses to apply (fix round 1): a stamp that is not two positive
// whole numbers, whatever Yjs content holds it, or one that would lower the board's layout.

/** The verdict of an update the relay may apply. */
const ACCEPTED = { kind: 'accepted' };

/** The verdict of an update whose stamp the relay refuses, written by the old build. */
const INVALID = { kind: 'invalid-stamp', writers: [OLD_BUILD] };

/**
 * The update a writer makes by setting the stamp's key to a value, on a board at a layout.
 *
 * @param value - What it stores under the stamp's key.
 * @param layoutVersion - The board's layout before; this build's by default.
 * @returns The relay's check and the update.
 */
function stampWrite(
  value: unknown,
  layoutVersion?: number,
): { check: UpdateStampCheck; update: Uint8Array } {
  const relay = relayHolding(createFixtureStore().encodeState());
  if (layoutVersion !== undefined) {
    relay.getMap(META_MAP_NAME).set(DOCUMENT_META_KEY, { schemaVersion: 1, layoutVersion });
  }
  const writer = oldBuildOn(relay);
  const update = updateOf(writer, () => {
    writer.getMap<unknown>(META_MAP_NAME).set(DOCUMENT_META_KEY, value);
  });
  return { check: new UpdateStampCheck(relay), update };
}

describe('UpdateStampCheck, stamps', () => {
  it('accepts this build’s stamp, and one naming a higher layout', () => {
    const same = stampWrite(createDocumentMeta());
    expect(same.check.check(same.update)).toEqual(ACCEPTED);
    const higher = stampWrite(
      { schemaVersion: 2, layoutVersion: DOCUMENT_LAYOUT_VERSION },
      DOCUMENT_LAYOUT_VERSION - 1,
    );
    expect(higher.check.check(higher.update)).toEqual(ACCEPTED);
  });

  it('refuses a stamp that would take the board back to a lower layout', () => {
    const lower = stampWrite({ schemaVersion: 1, layoutVersion: 1 }, 2);
    expect(lower.check.check(lower.update)).toEqual(INVALID);
  });

  it('refuses a malformed stamp: wrong fields, binary, or a shared type', () => {
    for (const value of [
      { schemaVersion: 1, layoutVersion: '1' },
      'layout 1',
      Uint8Array.of(1),
      new Y.Map([['layoutVersion', 1]]),
    ]) {
      const write = stampWrite(value);
      expect(write.check.check(write.update)).toEqual(INVALID);
    }
  });

  it('does not judge a stamp the same update replaces, only the one that stays', () => {
    const relay = relayHolding(createFixtureStore().encodeState());
    const writer = oldBuildOn(relay);
    const update = updateOf(writer, () => {
      const meta = writer.getMap<unknown>(META_MAP_NAME);
      meta.set(DOCUMENT_META_KEY, 'draft');
      meta.set(DOCUMENT_META_KEY, createDocumentMeta());
    });
    expect(new UpdateStampCheck(relay).check(update)).toEqual(ACCEPTED);
  });
});
