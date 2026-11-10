// Acceptance
import { describe, expect, it } from 'vitest';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { componentObjectSchema } from '../objects/component-object.js';

import {
  instanceOverridesSchema,
  overrideFieldsSchema,
  overrideRecordSchema,
} from './instance-overrides.js';
import { editableOverrideFields, instanceOverrideFields } from './override-content.js';

const PADDING = { top: 1, right: 2, bottom: 3, left: 4 };
const GEOMETRY = ['x', 'y', 'width', 'height', 'autoLayout'];

describe('preset geometry record fields', () => {
  it.each([
    { x: -12 },
    { y: 0.25 },
    { width: 0 },
    { height: 40 },
    { autoLayout: { direction: 'column' } },
    { autoLayout: { gap: 7, padding: PADDING, align: 'end', justify: 'center' } },
  ])('accepts a record with %j', (record) => {
    expect(overrideFieldsSchema.safeParse(record).success).toBe(true);
    expect(overrideRecordSchema.safeParse(record).success).toBe(true);
  });

  it.each([
    { x: Number.NaN },
    { y: Number.POSITIVE_INFINITY },
    { x: Number.NEGATIVE_INFINITY },
    { width: -1 },
    { height: -0.01 },
    { width: Number.POSITIVE_INFINITY },
    { height: Number.NaN },
  ])('rejects invalid geometry %j', (record) => {
    expect(overrideFieldsSchema.safeParse(record).success).toBe(false);
  });

  it.each([
    { padding: { top: 1 } },
    { padding: { ...PADDING, right: -1 } },
    { padding: { ...PADDING, left: Number.POSITIVE_INFINITY } },
    { padding: { ...PADDING, extra: 1 } },
    { width: 'hug' },
    { height: 'fixed' },
    { gap: -(2 ** 30) - 1 },
    { gap: Number.NaN },
    { direction: 'diagonal' },
    { unknown: true },
  ])('rejects an invalid auto-layout patch %j', (patch) => {
    expect(overrideFieldsSchema.safeParse({ autoLayout: patch }).success).toBe(false);
  });

  it('rejects unknown record keys and accepts the root path in a preset', () => {
    expect(overrideFieldsSchema.safeParse({ x: 1, depth: 2 }).success).toBe(false);
    expect(
      instanceOverridesSchema.safeParse({
        main: { width: 80, height: 60, autoLayout: { gap: 4 } },
      }).success,
    ).toBe(true);
    const main = sampleObject('component', 'main');
    expect(
      componentObjectSchema.safeParse({
        ...main,
        variantAxes: [{ name: 'Size', values: ['Small', 'Large'] }],
        variantPresets: {
          'Size=Large': { main: { width: 80, height: 60, autoLayout: { gap: 4 } } },
        },
      }).success,
    ).toBe(true);
  });
});

describe('geometry vocabulary by source type', () => {
  it.each([
    ['shape', ['x', 'y', 'width', 'height']],
    ['path', ['x', 'y']],
    ['image', ['x', 'y', 'width', 'height']],
    ['frame', GEOMETRY],
    ['group', ['x', 'y']],
    ['sticky', ['x', 'y', 'width', 'height']],
    ['instance', ['x', 'y', 'width', 'height']],
    ['text', ['x', 'y', 'width']],
    ['line', []],
    ['connector', []],
    ['comment', []],
  ] as const)('offers the specified geometry for %s, but no inspector rows', (type, expected) => {
    const child = sampleObject(type, `child-${type}`);
    const allowed = instanceOverrideFields(child);
    const editable = editableOverrideFields(child);
    expect(allowed.filter((field) => GEOMETRY.includes(field)).sort()).toEqual(
      [...expected].sort(),
    );
    expect(editable.filter((field) => GEOMETRY.includes(field))).toEqual([]);
  });
});
