// A peer's update can put any plain value the wire carries into a text's fields, a
// `bigint` among them (`@canvas/document` now refuses such an object when it decodes, but the
// key must not depend on that). `textContentKey` ran `JSON.stringify` on the fields, which
// throws on a bigint, out of `noteEditing` (a user starting to edit) and out of a microtask (a
// remote change to the edited text).
import { describe, expect, it } from 'vitest';

import type { ObjectId, PrincipalId, TextObject } from '@canvas/schema';
import type { TextBoxObject } from '@canvas/tools';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { textContentKey } from './text-size-follower.js';

const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ID = 'shared' as ObjectId;

const TEXT: TextObject = {
  id: ID,
  type: 'text',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: ADA.principalId,
  createdAt: 1,
  updatedAt: 1,
  width: 28.8,
  height: 30,
  text: 'ab',
  runs: [{ length: 2, style: DEFAULT_TEXT_STYLE }],
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
};

/**
 * A text as a decoder that trusts the wire would hand it over: with a field the schema forbids.
 *
 * @param change - The fields to overwrite.
 * @returns The text.
 */
function hostile(change: Readonly<Record<string, unknown>>): TextBoxObject {
  return { ...TEXT, ...change };
}

describe('textContentKey of a text a peer left with an odd value', () => {
  it.each([
    ['a bigint align', { align: 5n }],
    ['a bigint width in a fixed-width text', { autoWidth: false, width: 2n ** 62n }],
    ['a bigint in a run', { runs: [{ length: 2, style: { ...DEFAULT_TEXT_STYLE, weight: 7n } }] }],
  ])('%s gives a key and does not throw', (kind, change) => {
    const text = hostile(change);
    expect(() => textContentKey(text)).not.toThrow();
    expect(textContentKey(text)).not.toBe(textContentKey(TEXT));
  });

  it('gives a key for a cyclic run list', () => {
    const runs: unknown[] = [];
    runs.push(runs);
    expect(() => textContentKey(hostile({ runs }))).not.toThrow();
  });

  it('never gives the same key twice for content it cannot write down', () => {
    const text = hostile({ align: 5n });
    expect(textContentKey(text)).not.toBe(textContentKey(text));
  });

  it('is unchanged for an ordinary text', () => {
    expect(textContentKey(TEXT)).toBe(textContentKey({ ...TEXT }));
  });
});
