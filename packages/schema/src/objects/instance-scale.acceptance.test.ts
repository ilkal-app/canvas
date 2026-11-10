import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import { instance } from '../instances/__fixtures__/component-board.js';

describe('instance content scale', () => {
  it('exports the inclusive scale bounds', () => {
    expect(Reflect.get(schema, 'INSTANCE_SCALE_MIN')).toBe(0.05);
    expect(Reflect.get(schema, 'INSTANCE_SCALE_MAX')).toBe(20);
  });

  it('accepts absence as implicit 1 and retains the drawn box', () => {
    const source = instance('inst', 'main', { width: 200, height: 100 });
    const parsed = schema.instanceObjectSchema.parse(source);
    expect(parsed).toMatchObject({ width: 200, height: 100 });
    expect(Reflect.get(parsed, 'scale')).toBeUndefined();
  });

  it.each([0.05, 0.5, 1, 2, 20])('accepts scale %s', (scale) => {
    expect(schema.instanceObjectSchema.parse(instance('inst', 'main', { scale }))).toMatchObject({
      scale,
      width: 200,
      height: 100,
    });
  });

  it.each([0, -1, 0.049, 20.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses scale %s',
    (scale) => {
      expect(
        schema.instanceObjectSchema.safeParse(instance('inst', 'main', { scale })).success,
      ).toBe(false);
    },
  );
});
