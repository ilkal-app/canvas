// The one way the codec words an undecoded value in a message. Remote updates carry
// whatever lib0 can encode (bigint, binary, nested arrays and objects, keys like `__proto__`),
// so the helper must never throw, whatever it is given, and never grow with the value.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  describeId,
  describeJson,
  describeValue,
  MAX_DESCRIBED_JSON,
  MAX_DESCRIBED_TEXT,
} from './describe-value.js';

/** The longest description any value may get: the text bound plus the fixed words around it. */
const MAX_DESCRIPTION = MAX_DESCRIBED_TEXT + 40;

/**
 * A proxy whose every trap throws, as a hostile value would.
 *
 * @returns The proxy.
 */
function throwingProxy(): object {
  const fail = () => {
    throw new Error('trap');
  };
  return new Proxy(
    {},
    {
      get: fail,
      getPrototypeOf: fail,
      ownKeys: fail,
      has: fail,
      getOwnPropertyDescriptor: fail,
    },
  );
}

describe('describeValue', () => {
  it.each([
    ['a string', 'abc', '"abc"'],
    ['a string with a quote', 'a"b', '"a\\"b"'],
    ['an empty string', '', '""'],
    ['a number', 12.5, '12.5'],
    ['NaN', Number.NaN, 'NaN'],
    ['a boolean', false, 'false'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a bigint', 10n, '10n'],
    ['a negative bigint', -(2n ** 63n), '-9223372036854775808n'],
    ['a symbol', Symbol('tag'), 'Symbol(tag)'],
    ['a function', () => 1, 'a function'],
  ] as const)('describes %s', (kind, value, expected) => {
    expect(describeValue(value)).toBe(expected);
  });

  it.each([
    ['a plain object', { a: 1 }, /object/],
    ['an array', [1, 2, 3], /array/],
    ['a typed array', new Uint8Array([1, 2]), /binary.*2 bytes/],
    ['an array buffer', new ArrayBuffer(5), /binary.*5 bytes/],
  ] as const)('names %s by its kind', (kind, value, expected) => {
    expect(describeValue(value)).toMatch(expected);
  });

  it('names a shared type by its kind and never converts it', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('m');
    const array = doc.getArray('a');
    const text = doc.getText('t');
    let conversions = 0;
    for (const type of [map, array, text]) {
      (type as { toJSON: () => unknown }).toJSON = () => {
        conversions += 1;
        return {};
      };
    }
    expect(describeValue(map)).toMatch(/Y\.Map/);
    expect(describeValue(array)).toMatch(/Y\.Array/);
    expect(describeValue(text)).toMatch(/Y\.Text/);
    expect(describeValue(new Y.XmlFragment())).toMatch(/Y\.XmlFragment/);
    expect(describeValue(new Y.Doc())).toMatch(/Y\.Doc/);
    expect(conversions).toBe(0);
  });

  it('cuts a very long string to a bounded length and keeps its start', () => {
    const description = describeValue(`start${'x'.repeat(1_000_000)}`);
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(description.startsWith('"start')).toBe(true);
    expect(description).toContain('1000005');
  });

  it('does not cut a surrogate pair in half', () => {
    // Index 47 is a high surrogate, so a cut at 48 would split the pair.
    const description = describeValue(`a${'😀'.repeat(MAX_DESCRIBED_TEXT)}`);
    expect(description).not.toMatch(/\\ud[89ab]/i);
    expect(description.startsWith('"a😀')).toBe(true);
  });

  it('escapes what could spoof a terminal or a line: C1 controls, U+2028, U+2029 and bidi controls', () => {
    const hostile = '\u0085\u009b\u2028\u2029\u202a\u202e\u2066\u2069\u200e\u200f\u061c';
    for (const description of [
      describeValue(`x${hostile}`),
      describeValue(Symbol(hostile)),
      describeJson({ a: hostile }),
    ]) {
      expect(description).not.toMatch(
        /[\u0080-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/,
      );
      expect(description).toContain('\\u202e');
    }
  });

  it('bounds a huge bigint', () => {
    expect(describeValue(2n ** 100_000n).length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });

  it('bounds a long symbol description', () => {
    expect(describeValue(Symbol('y'.repeat(100_000))).length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });

  it('describes a cyclic object and a cyclic array', () => {
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push(array);
    expect(() => describeValue(object)).not.toThrow();
    expect(() => describeValue(array)).not.toThrow();
  });

  it('describes an object with a throwing toJSON, toString, valueOf or getter', () => {
    const value = {
      toJSON() {
        throw new Error('toJSON');
      },
      toString() {
        throw new Error('toString');
      },
      valueOf() {
        throw new Error('valueOf');
      },
      get field(): number {
        throw new Error('getter');
      },
    };
    expect(() => describeValue(value)).not.toThrow();
  });

  it('describes an object that cannot be turned into a string', () => {
    const noPrototype = JSON.parse('{"__proto__": null}') as unknown;
    const overridden = { toString: 1 };
    expect(() => describeValue(noPrototype)).not.toThrow();
    expect(() => describeValue(overridden)).not.toThrow();
  });

  it('describes a value whose every trap throws', () => {
    expect(() => describeValue(throwingProxy())).not.toThrow();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => describeValue(revoked.proxy)).not.toThrow();
    expect(typeof describeValue(throwingProxy())).toBe('string');
  });

  it('describes a 20,000-deep nested array without recursing', () => {
    let value: unknown[] = [];
    for (let level = 0; level < 20_000; level += 1) value = [value];
    expect(() => describeValue(value)).not.toThrow();
    expect(describeValue(value).length).toBeLessThanOrEqual(MAX_DESCRIPTION);
  });
});

describe('describeJson', () => {
  it('writes a small plain value as JSON', () => {
    expect(describeJson({ schemaVersion: 1, layoutVersion: 99 })).toBe(
      '{"schemaVersion":1,"layoutVersion":99}',
    );
    expect(describeJson([1, 'a'])).toBe('[1,"a"]');
  });

  it('describes anything else as describeValue does', () => {
    expect(describeJson(5n)).toBe('5n');
    expect(describeJson('abc')).toBe('"abc"');
    expect(describeJson(new Uint8Array(3))).toBe(describeValue(new Uint8Array(3)));
    expect(describeJson(undefined)).toBe('undefined');
  });

  it('cuts long JSON to a bounded length and says how long it was', () => {
    const description = describeJson({ note: 'n'.repeat(1_000_000) });
    expect(description.length).toBeLessThanOrEqual(MAX_DESCRIBED_JSON + 40);
    expect(description).toContain('characters)');
  });

  it('falls back when JSON cannot be written: a bigint inside, a cycle, a throwing toJSON', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const hostile = {
      toJSON() {
        throw new Error('toJSON');
      },
    };
    for (const value of [{ layoutVersion: 2n }, cycle, hostile, throwingProxy()]) {
      expect(() => describeJson(value)).not.toThrow();
      expect(describeJson(value).length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    }
    expect(describeJson({ toJSON: () => undefined })).toBe('an object');
  });

  it('never converts a shared type', () => {
    let conversions = 0;
    const map = new Y.Doc().getMap('m');
    (map as { toJSON: () => unknown }).toJSON = () => {
      conversions += 1;
      return {};
    };
    expect(describeJson(map)).toMatch(/Y\.Map/);
    expect(conversions).toBe(0);
  });

  it('does not cut a surrogate pair in half at its bound', () => {
    const description = describeJson({ n: `${'x'.repeat(MAX_DESCRIBED_JSON - 7)}😀tail` });
    expect(description).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(description).toContain('characters)');
  });
});

describe('describeId', () => {
  it('gives a string as it is and describes anything else', () => {
    expect(describeId('s1')).toBe('s1');
    expect(describeId(5n)).toBe('5n');
    expect(describeId({ toString: 1 })).toBe('an object');
  });
});
