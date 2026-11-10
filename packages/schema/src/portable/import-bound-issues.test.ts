import { expect, it } from 'vitest';

import { nonFiniteIssues } from './import-bound-issues.js';

it('preserves ordered nested paths and object attribution without aliasing findings', () => {
  const shared = Object.freeze({ finite: Number.MAX_VALUE, invalid: Infinity });
  const objects = [
    {
      id: 'shape',
      x: NaN,
      styles: [shared, { levels: [-Infinity, 0, shared] }],
      label: 'Infinity',
    },
    { payload: [null, false, { amount: Infinity }] },
    null,
    { id: 7, invalid: -Infinity },
  ];
  const findings = nonFiniteIssues({ schemaVersion: 1, objects });
  expect(
    findings.map(({ objectId, path, message, code, relatedId }) => ({
      objectId,
      path,
      message,
      code,
      relatedId,
    })),
  ).toEqual([
    {
      objectId: 'shape',
      path: ['x'],
      message: 'x is not a finite number',
      code: 'out-of-bound',
      relatedId: null,
    },
    {
      objectId: 'shape',
      path: ['styles', 0, 'invalid'],
      message: 'styles.0.invalid is not a finite number',
      code: 'out-of-bound',
      relatedId: null,
    },
    {
      objectId: 'shape',
      path: ['styles', 1, 'levels', 0],
      message: 'styles.1.levels.0 is not a finite number',
      code: 'out-of-bound',
      relatedId: null,
    },
    {
      objectId: 'shape',
      path: ['styles', 1, 'levels', 2, 'invalid'],
      message: 'styles.1.levels.2.invalid is not a finite number',
      code: 'out-of-bound',
      relatedId: null,
    },
    {
      objectId: null,
      path: ['objects', 1, 'payload', 2, 'amount'],
      message: 'payload.2.amount is not a finite number',
      code: 'out-of-bound',
      relatedId: null,
    },
    {
      objectId: null,
      path: ['objects', 3, 'invalid'],
      message: 'invalid is not a finite number',
      code: 'out-of-bound',
      relatedId: null,
    },
  ]);
  expect(new Set(findings.map(({ path }) => path)).size).toBe(findings.length);
});

it('matches an independent stack oracle for finite and nonfinite primitives in nested JSON', () => {
  const values: unknown[] = [
    0,
    -0,
    1,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    NaN,
    Infinity,
    -Infinity,
    '',
    'NaN',
    null,
    true,
    false,
    undefined,
  ];
  for (let seed = 0; seed < values.length; seed += 1) {
    const object = {
      id: 'subject',
      first: values[seed],
      nested: values.map((value, index) => ({
        [String(index)]: [value, values[(index + seed) % values.length]],
      })),
    };
    const expected: (string | number)[][] = [];
    const stack: { value: unknown; path: (string | number)[] }[] = [{ value: object, path: [] }];
    while (stack.length > 0) {
      const item = stack.pop();
      if (item === undefined) throw new Error('Missing oracle item.');
      if (typeof item.value === 'number' && !Number.isFinite(item.value)) expected.push(item.path);
      else if (item.value !== null && typeof item.value === 'object') {
        const keys = Object.keys(item.value);
        for (const key of keys.reverse())
          stack.push({
            value: (item.value as Record<string, unknown>)[key],
            path: [...item.path, Array.isArray(item.value) ? Number(key) : key],
          });
      }
    }
    expect(
      nonFiniteIssues({ schemaVersion: 1, objects: [object] }).map(({ path }) => path),
    ).toEqual(expected);
  }
});

it('ignores missing object lists and sparse array holes while retaining actual indices', () => {
  expect(nonFiniteIssues({ schemaVersion: 1 })).toEqual([]);
  const sparse: unknown[] = new Array(5);
  sparse[3] = Infinity;
  expect(
    nonFiniteIssues({ schemaVersion: 1, objects: [{ id: 'shape', sparse }] }).map(
      ({ path }) => path,
    ),
  ).toEqual([['sparse', 3]]);
});
