import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type * as stringModule from 'lib0/string';
import { expect, it, vi } from 'vitest';

import { MalformedUpdateError, readBoundedString } from './update-bounds.js';

vi.mock('lib0/string', async (importOriginal) => {
  const original = await importOriginal<typeof stringModule>();
  return { ...original, decodeUtf8: original._decodeUtf8Polyfill };
});

it('decodes a bounded Unicode name through the pinned UTF-8 fallback', () => {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, 'héllo 👩‍💻');
  const bytes = encoding.toUint8Array(encoder);
  const decoder = decoding.createDecoder(bytes);
  expect(readBoundedString(decoder)).toBe('héllo 👩‍💻');
  expect(decoder.pos).toBe(bytes.length);
});

it('rejects a declared name beyond the bytes before calling the fallback', () => {
  const decoder = decoding.createDecoder(Uint8Array.of(9, 0x61));
  expect(() => readBoundedString(decoder)).toThrow(MalformedUpdateError);
});
