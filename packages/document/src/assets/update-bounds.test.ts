import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { UpdateStampCheck } from '../meta/update-stamp-check.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import {
  arrayCountOverflowUpdate,
  COUNT_OVERFLOW_UPDATE,
  deepNestingUpdate,
} from './__fixtures__/hostile-updates.js';
import { MalformedUpdateError, type MalformedUpdateCause } from './update-bounds.js';
import { UpdateDepthError } from './update-depth.js';
import { assertUpdateDepth, scanUpdate } from './update-scan.js';

/**
 * One `ContentAny` item under the top-level type `a`, with no delete set after it.
 *
 * @param count - How many values it declares.
 * @param values - The bytes after the count.
 * @returns The update's bytes.
 */
function plainItem(count: number, ...values: number[]): Uint8Array {
  return Uint8Array.from([1, 1, 1, 0, 8, 1, 1, 0x61, count, ...values]);
}

/**
 * The error a function throws.
 *
 * @param run - The function.
 * @returns What it threw.
 * @throws {Error} When the function returns instead.
 */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

/**
 * Checks that the scan refuses bytes quickly with a malformed-update cause, in both modes.
 *
 * @param update - The bytes.
 * @param code - The expected cause.
 */
function expectMalformed(update: Uint8Array, code: MalformedUpdateCause): void {
  const started = performance.now();
  for (const run of [
    () => {
      assertUpdateDepth(update);
    },
    () => scanUpdate(update, new Set(), { shouldKeepEveryStruct: true }),
  ]) {
    const error = thrownBy(run);
    expect(error).toBeInstanceOf(MalformedUpdateError);
    expect((error as MalformedUpdateError).code).toBe(code);
  }
  expect(performance.now() - started).toBeLessThan(1000);
}

describe('the update scan reads within the bytes it was given', () => {
  it.each([
    ['plain values', COUNT_OVERFLOW_UPDATE],
    ['array elements', arrayCountOverflowUpdate()],
    ['object entries', plainItem(1, 118, 0xff, 0xff, 0xff, 0x7f)],
    ['JSON strings', Uint8Array.from([1, 1, 1, 0, 2, 1, 1, 0x61, 0xff, 0xff, 0x7f])],
    ['structs', Uint8Array.from([1, 0xff, 0xff, 0xff, 0x7f, 1, 0])],
    ['clients', Uint8Array.from([0xff, 0xff, 0xff, 0x7f])],
    ['deleted ranges', Uint8Array.from([0, 1, 1, 0xff, 0xff, 0xff, 0x7f])],
  ])('refuses a count of %s larger than the bytes left, at once', (label, update) => {
    expectMalformed(update, 'count-exceeds-bytes');
  });

  it.each([
    ['a value tag', plainItem(1, 118, 1, 0)],
    ['an integer', plainItem(1, 125, 0x80)],
    ['a float', plainItem(1, 124, 0, 0)],
    ['a double', plainItem(1, 123, 0, 0, 0, 0)],
    ['a string', plainItem(1, 119, 9, 0x61)],
    ['a parent name', Uint8Array.from([1, 1, 1, 0, 8, 1, 9, 0x61])],
    ['a parent key', Uint8Array.from([1, 1, 1, 0, 40, 1, 1, 0x61, 9, 0x62])],
    ['a struct info byte', Uint8Array.from([1, 1, 1, 0])],
  ])('refuses %s cut off by the end of the bytes', (label, update) => {
    expectMalformed(update, 'truncated');
  });

  it('refuses a plain value tag lib0 never writes, as lib0 readAny does', () => {
    expectMalformed(plainItem(1, 3, 0), 'unknown-value');
  });

  it('refuses the hostile bytes in the store and the stamp check without hanging', () => {
    const store = new YjsDocumentStore();
    const before = store.encodeState();
    expect(() => {
      store.applyUpdate(COUNT_OVERFLOW_UPDATE, SYSTEM_ORIGIN);
    }).toThrow(MalformedUpdateError);
    expect(store.encodeState()).toEqual(before);
    store.destroy();
    const doc = new Y.Doc();
    expect(new UpdateStampCheck(doc).check(COUNT_OVERFLOW_UPDATE)).toEqual({
      kind: 'unprovable',
      cause: 'unreadable-update',
      writers: [],
    });
    doc.destroy();
  });
});

describe('nesting far past the stack is refused before decoding', () => {
  it.each([5_000, 200_000])('refuses %i levels in the scan, the store and the gate', (levels) => {
    const update = deepNestingUpdate(levels);
    expect(() => {
      assertUpdateDepth(update);
    }).toThrow(UpdateDepthError);
    const store = new YjsDocumentStore();
    const received: Uint8Array[] = [];
    store.subscribeUpdates(({ update: bytes }) => received.push(bytes));
    expect(() => {
      store.applyUpdate(update, SYSTEM_ORIGIN);
    }).toThrow(UpdateDepthError);
    expect(received).toEqual([]);
    store.destroy();
    const doc = new Y.Doc();
    expect(new UpdateStampCheck(doc).check(update)).toEqual({
      kind: 'update-depth-exceeded',
      writers: [],
    });
    doc.destroy();
  });

  it('accepts the same hand-built bytes at the bound', () => {
    expect(() => {
      assertUpdateDepth(deepNestingUpdate(128));
    }).not.toThrow();
    expect(() => {
      assertUpdateDepth(deepNestingUpdate(129));
    }).toThrow(UpdateDepthError);
  });
});
