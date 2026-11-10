import { describe, expect, it } from 'vitest';

import { BODY, fixtureObject } from './__fixtures__/store-fixtures.js';
import { findSplitCharacterIssues, validateObject } from './object-validation.js';

/** "Ship the beta 😀" with a second run starting at 15, inside the emoji's surrogate pair. */
const SPLIT = {
  text: 'Ship the beta 😀',
  runs: [
    { length: 15, style: BODY },
    { length: 1, style: { ...BODY, weight: 700 as const } },
  ],
};

describe('validateObject', () => {
  it('refuses runs that split a surrogate pair through the schema, naming the run', () => {
    const validation = validateObject({ ...fixtureObject('sticky-idea', 'sticky'), ...SPLIT });
    expect(validation).toMatchObject({ isValid: false, objectId: 'sticky-idea' });
    expect(validation.isValid ? [] : validation.issues.map((issue) => issue.path)).toEqual([
      ['runs', 1],
    ]);
  });
});

describe('validateObject of what is not an object of a known type', () => {
  it('validates it whole, naming no id when it has none', () => {
    const stored = fixtureObject('shape-box', 'shape');
    expect(validateObject(5)).toMatchObject({ isValid: false, objectId: '?' });
    expect(validateObject(5, stored)).toMatchObject({ isValid: false, objectId: '?' });
    expect(validateObject({ ...stored, type: 'blob' }, stored)).toMatchObject({
      isValid: false,
      objectId: 'shape-box',
    });
  });
});

describe('validateObject with the stored z', () => {
  //'s stored-key exception, now one case of the field-scoped rule: a write that
  // leaves the stored `z` as it is does not judge it.
  const stored = { ...fixtureObject('image-photo', 'image'), z: 'legacy' };

  it('accepts an object whose invalid z is the stored one, keeping it', () => {
    const validation = validateObject({ ...stored, x: 5 }, stored);
    expect(validation).toMatchObject({ isValid: true, object: { z: 'legacy', x: 5 } });
  });

  it('refuses an invalid z that differs from the stored one, or with nothing stored', () => {
    expect(validateObject({ ...stored, z: 'other' }, stored).isValid).toBe(false);
    expect(validateObject(stored).isValid).toBe(false);
  });

  it('still reports every other problem of an object that keeps its stored z', () => {
    const validation = validateObject({ ...stored, x: 'left' }, stored);
    expect(validation.isValid ? [] : validation.issues.map((issue) => issue.path)).toEqual([['x']]);
  });

  it('keeps an invalid z when only the z of an entry that cannot be read is known', () => {
    const validation = validateObject({ ...stored, x: 5 }, { z: 'legacy' });
    expect(validation).toMatchObject({ isValid: true, object: { z: 'legacy', x: 5 } });
  });
});

describe('findSplitCharacterIssues', () => {
  // The schema refuses these runs first, so the defence in depth is driven directly with objects
  // that skipped it, as a regression in the schema would let through.
  it('finds split runs in a sticky body and in a shape label, by field path', () => {
    const sticky = { ...fixtureObject('sticky-idea', 'sticky'), ...SPLIT };
    const shape = { ...fixtureObject('shape-box', 'shape'), label: SPLIT };
    expect(findSplitCharacterIssues(sticky).map((issue) => issue.path)).toEqual([['runs', 1]]);
    expect(findSplitCharacterIssues(shape).map((issue) => issue.path)).toEqual([
      ['label', 'runs', 1],
    ]);
  });

  it('finds nothing in schema-valid objects, labelled or not', () => {
    expect(findSplitCharacterIssues(fixtureObject('sticky-idea', 'sticky'))).toEqual([]);
    expect(findSplitCharacterIssues(fixtureObject('shape-box', 'shape'))).toEqual([]);
    expect(findSplitCharacterIssues(fixtureObject('group-diagram', 'group'))).toEqual([]);
  });
});
