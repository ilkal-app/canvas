import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';

import { NO_CLIENT, type ScannedContent, type ScannedItem } from '../assets/update-scan.js';

import { judgePageWrites } from './page-values.js';

/**
 * A scanned item of the given content whose value starts at the beginning of the bytes.
 *
 * @param content - What the item holds.
 * @returns The item.
 */
function itemOf(content: ScannedContent): ScannedItem {
  return {
    client: 1,
    clock: 0,
    length: 1,
    content,
    originClient: NO_CLIENT,
    originClock: 0,
    rightOriginClient: NO_CLIENT,
    rightOriginClock: 0,
    parentName: 'pages',
    parentClient: NO_CLIENT,
    parentClock: 0,
    parentSub: 'page-2.name',
    detail: 0,
  };
}

/**
 * The bytes of one JSON value as Yjs writes a `json` item's values: a count, then the strings.
 *
 * @param text - The JSON text.
 * @returns The bytes.
 */
function jsonBytes(text: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarString(encoder, text);
  return encoding.toUint8Array(encoder);
}

describe('judgePageWrites', () => {
  it('refuses a page value that is not plain: a shared type, or JSON that does not parse', () => {
    expect(
      judgePageWrites(new Uint8Array(), [{ item: itemOf('type'), key: 'page-2.name' }]),
    ).toEqual(expect.objectContaining({ key: 'page-2.name', reason: 'not-a-plain-value' }));
    expect(
      judgePageWrites(jsonBytes('{"name":'), [{ item: itemOf('json'), key: 'page-2.name' }]),
    ).toEqual(expect.objectContaining({ pageKey: 'page-2.name', reason: 'not-a-plain-value' }));
  });

  it('passes a name written as JSON', () => {
    expect(
      judgePageWrites(jsonBytes('"Notes"'), [{ item: itemOf('json'), key: 'page-2.name' }]),
    ).toBeUndefined();
  });
});
