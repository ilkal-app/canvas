// Acceptance
import { describe, expect, it } from 'vitest';

import {
  MAX_VARIANT_AXES,
  MAX_VARIANT_NAME,
  MAX_VARIANT_VALUES,
  parsePresetKey,
  presetKey,
  selectedValues,
  variantAxesSchema,
  variantAxisSchema,
  variantSelectionSchema,
} from '@canvas/schema';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { componentObjectSchema } from '../objects/component-object.js';
import { instanceObjectSchema } from '../objects/instance-object.js';

import { overrideRecordSchema } from './instance-overrides.js';
import { instanceOverrideFields } from './override-content.js';

const AXES = [
  { name: 'Size', values: ['Small', 'Large'] },
  { name: 'State', values: ['Idle', 'Busy'] },
];

describe('variant schema limits and names', () => {
  it('exports the ticket limits and accepts their inclusive boundaries', () => {
    expect([MAX_VARIANT_AXES, MAX_VARIANT_VALUES, MAX_VARIANT_NAME]).toEqual([8, 32, 64]);
    expect(
      variantAxisSchema.safeParse({ name: 'a'.repeat(64), values: ['v'.repeat(64)] }).success,
    ).toBe(true);
    expect(
      variantAxesSchema.safeParse(
        Array.from({ length: 8 }, (unused, index) => ({
          name: `axis${String(index)}`,
          values: Array.from({ length: 32 }, (unused, value) => `value${String(value)}`),
        })),
      ).success,
    ).toBe(true);
    expect(
      variantSelectionSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: 8 }, (unused, index) => [
            `axis${String(index)}`,
            `value${String(index)}`,
          ]),
        ),
      ).success,
    ).toBe(true);
  });

  it.each(['', ' leading', 'trailing ', 'a=b', 'a'.repeat(65)])(
    'rejects invalid name %j in every position',
    (name) => {
      expect(variantAxisSchema.safeParse({ name, values: ['Default'] }).success).toBe(false);
      expect(variantAxisSchema.safeParse({ name: 'Axis', values: [name] }).success).toBe(false);
      expect(variantSelectionSchema.safeParse({ [name]: 'Value' }).success).toBe(false);
      expect(variantSelectionSchema.safeParse({ Axis: name }).success).toBe(false);
    },
  );

  it('rejects missing, duplicate, or excess values and duplicate or excess axes', () => {
    for (const values of [
      [],
      ['A', 'A'],
      Array.from({ length: 33 }, (unused, index) => `v${String(index)}`),
    ])
      expect(variantAxisSchema.safeParse({ name: 'Axis', values }).success).toBe(false);
    expect(variantAxesSchema.safeParse([]).success).toBe(true);
    expect(
      variantAxesSchema.safeParse([
        { name: 'A', values: ['x'] },
        { name: 'A', values: ['y'] },
      ]).success,
    ).toBe(false);
    expect(
      variantAxesSchema.safeParse(
        Array.from({ length: 9 }, (unused, index) => ({
          name: `a${String(index)}`,
          values: ['x'],
        })),
      ).success,
    ).toBe(false);
    expect(
      variantSelectionSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: 9 }, (unused, index) => [`a${String(index)}`, 'x']),
        ),
      ).success,
    ).toBe(false);
  });
});

describe('preset keys and selection', () => {
  it('round-trips a valid axis and value', () => {
    expect(presetKey('Size', 'Large')).toBe('Size=Large');
    expect(parsePresetKey(presetKey('Size', 'Large'))).toEqual({ axis: 'Size', value: 'Large' });
  });

  it.each([
    'Size',
    '=Large',
    'Size=',
    'Size=Large=Extra',
    ' Size=Large',
    'Size=Large ',
    'a'.repeat(65) + '=x',
  ])('rejects malformed key %j', (key) => {
    expect(parsePresetKey(key)).toBeUndefined();
  });

  it('selects in axis order, using the first value for absent or obsolete selections', () => {
    expect(selectedValues(AXES, { State: 'Busy', Size: 'Gone', Old: 'Other' })).toEqual([
      ['Size', 'Small'],
      ['State', 'Busy'],
    ]);
    expect(selectedValues(AXES, {})).toEqual([
      ['Size', 'Small'],
      ['State', 'Idle'],
    ]);
  });
});

describe('variant fields on objects and overrides', () => {
  it('validates presets against the main axes and permits absent presets', () => {
    const main = sampleObject('component', 'main');
    expect(componentObjectSchema.safeParse({ ...main, variantAxes: AXES }).success).toBe(true);
    expect(
      componentObjectSchema.safeParse({ ...main, variantAxes: [], variantPresets: {} }).success,
    ).toBe(true);
    expect(
      componentObjectSchema.safeParse({ ...main, variantPresets: { 'Size=Small': {} } }).success,
    ).toBe(false);
    expect(
      componentObjectSchema.safeParse({
        ...main,
        variantAxes: AXES,
        variantPresets: { 'Old=Yes': {} },
      }).success,
    ).toBe(false);
    expect(
      componentObjectSchema.safeParse({
        ...main,
        variantAxes: AXES,
        variantPresets: { 'Size=Gone': {} },
      }).success,
    ).toBe(false);
    expect(
      componentObjectSchema.safeParse({
        ...main,
        variantAxes: AXES,
        variantPresets: { 'Size=Large': { child: { isHidden: true } } },
      }).success,
    ).toBe(true);
  });

  it('keeps an instance selection even if its main no longer lists the axis or value', () => {
    const object = sampleObject('instance', 'inst');
    expect(
      instanceObjectSchema.parse({ ...object, variant: { Old: 'Removed', Size: 'Gone' } }),
    ).toMatchObject({ variant: { Old: 'Removed', Size: 'Gone' } });
  });

  it('allows variant on an instance child only', () => {
    expect(overrideRecordSchema.safeParse({ variant: { Size: 'Large' } }).success).toBe(true);
    for (const type of [
      'component',
      'instance',
      'frame',
      'group',
      'shape',
      'text',
      'sticky',
      'image',
      'video',
      'line',
      'path',
      'connector',
      'comment',
    ] as const) {
      const fields = instanceOverrideFields(sampleObject(type, `child-${type}`));
      expect((fields as readonly string[]).includes('variant')).toBe(type === 'instance');
    }
  });
});
