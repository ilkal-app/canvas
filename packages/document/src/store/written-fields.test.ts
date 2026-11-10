import { describe, expect, it } from 'vitest';

import { boardObjectSchema } from '@canvas/schema';

import { BODY, fixtureObject } from './__fixtures__/store-fixtures.js';
import { checkWrittenFields, FIELD_UNITS } from './written-fields.js';

/**
 * The paths of a check's issues.
 *
 * @param object - The object as written.
 * @param stored - The object as stored.
 * @returns The paths, joined.
 */
function issuePaths(object: unknown, stored: Readonly<Record<string, unknown>>): string[] {
  return (checkWrittenFields(object, stored)?.issues ?? []).map(({ path }) => path.join('.'));
}

describe('checkWrittenFields', () => {
  const shape = fixtureObject('shape-box', 'shape');
  const broken = { ...shape, width: -5, stroke: { color: 'ink', width: 2 } };

  it('lists a cross-field unit for every type whose schema has an object-level rule', () => {
    const withRules = boardObjectSchema.options
      .filter((option) => (option._zod.def.checks ?? []).length > 0)
      .map((option) => option.shape.type.value)
      .sort();
    expect(Object.keys(FIELD_UNITS).sort()).toEqual(withRules);
  });

  it('judges none of the fields a write leaves as stored, valid or not', () => {
    const checked = checkWrittenFields({ ...broken, x: 40 }, broken);
    expect(checked?.issues).toEqual([]);
    expect(checked?.written).toEqual(new Set(['x']));
    expect(checked?.object).toMatchObject({ x: 40, width: -5, stroke: broken.stroke });
  });

  it('judges a field it changes, whatever it was', () => {
    expect(issuePaths({ ...broken, width: -6 }, broken)).toEqual(['width']);
    expect(issuePaths({ ...broken, stroke: { color: [0, 0, 0, 1], width: -1 } }, broken)).toEqual([
      'stroke.width',
    ]);
  });

  it('takes a NaN it leaves as stored, by the door equality', () => {
    const nan = { ...shape, rotation: Number.NaN };
    expect(issuePaths({ ...nan, z: 'a5' }, nan)).toEqual([]);
    expect(issuePaths({ ...shape, rotation: Number.NaN }, shape)).toEqual(['rotation']);
  });

  it('refuses a key the type does not have, and a field the write lacks', () => {
    expect(issuePaths({ ...shape, colour: 'red' }, shape)).toEqual(['']);
    const { cornerRadius, ...lacking } = shape;
    expect(cornerRadius).toBe(12);
    expect(issuePaths(lacking, shape)).toEqual(['cornerRadius']);
  });

  it('leaves an optional field absent from both the write and the stored object unwritten', () => {
    // A shape stored before `shadow` existed, written without one: nothing about it changes.
    const checked = checkWrittenFields({ ...shape, x: 40 }, shape);
    expect(checked?.written.has('shadow')).toBe(false);
    expect(checked?.written).toEqual(new Set(['x']));
    expect(checked?.object.shadow).toBeUndefined();
    // Stored with one, a write that lacks it is a removal: written, and judged valid.
    const shadowed = { ...shape, shadow: { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 1] } };
    const removed = checkWrittenFields({ ...shape, x: 40 }, shadowed);
    expect(removed?.written.has('shadow')).toBe(true);
    expect(removed?.issues).toEqual([]);
    expect(removed?.object.shadow).toBeUndefined();
    // A required field absent from both is still refused.
    const lacking: Record<string, unknown> = { ...shape };
    delete lacking.cornerRadius;
    expect(issuePaths(lacking, lacking)).toEqual(['cornerRadius']);
  });

  it("judges a text's characters with the runs it leaves, which must still cover them", () => {
    const sticky = fixtureObject('sticky-idea', 'sticky');
    expect(issuePaths({ ...sticky, text: `${sticky.text}!` }, sticky)).toEqual(['runs']);
    const runs = [{ length: sticky.text.length + 1, style: BODY }];
    expect(issuePaths({ ...sticky, text: `${sticky.text}!`, runs }, sticky)).toEqual([]);
    const badRuns = { ...sticky, runs: [{ length: 1, style: { ...BODY, fontSize: -1 } }] };
    expect(issuePaths({ ...badRuns, x: 1 }, badRuns)).toEqual([]);
    expect(issuePaths({ ...badRuns, text: 'A' }, badRuns)).not.toEqual([]);
  });

  it('returns nothing for what is not an object of a known type', () => {
    expect(checkWrittenFields(null, shape)).toBeUndefined();
    expect(checkWrittenFields({ ...shape, type: 'blob' }, shape)).toBeUndefined();
  });
});
