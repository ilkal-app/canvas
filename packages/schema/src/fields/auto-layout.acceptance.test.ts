import { describe, expect, it } from 'vitest';

import { overrideRecordSchema } from '../instances/instance-overrides.js';
import { instanceOverrideFields } from '../instances/override-content.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { boardObjectSchema } from '../objects/board-object.js';
import { componentObjectSchema } from '../objects/component-object.js';
import { frameObjectSchema } from '../objects/frame-object.js';
import { instanceObjectSchema } from '../objects/instance-object.js';
import { shapeObjectSchema } from '../objects/shape-object.js';
import { stickyObjectSchema } from '../objects/sticky-object.js';
import { textObjectSchema } from '../objects/text-object.js';

import {
  AUTO_LAYOUT_ALIGNS,
  AUTO_LAYOUT_DIRECTIONS,
  AUTO_LAYOUT_JUSTIFIES,
  AUTO_LAYOUT_SIZINGS,
  autoLayoutSchema,
  layoutChildSchema,
  type AutoLayout,
  type LayoutChild,
} from './auto-layout.js';
import { BOARD_BOUND } from './board-bound.js';

const AUTO_LAYOUT: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 1, right: 2, bottom: 3, left: 4 },
  align: 'center',
  justify: 'space-between',
  width: 'fixed',
  height: 'hug',
};
const LAYOUT_CHILD: LayoutChild = { fill: true };

describe('auto-layout fields', () => {
  it('exports the complete stored vocabulary', () => {
    expect(AUTO_LAYOUT_DIRECTIONS).toEqual(['row', 'column']);
    expect(AUTO_LAYOUT_ALIGNS).toEqual(['start', 'center', 'end', 'stretch']);
    expect(AUTO_LAYOUT_JUSTIFIES).toEqual(['start', 'center', 'end', 'space-between']);
    expect(AUTO_LAYOUT_SIZINGS).toEqual(['hug', 'fixed']);
  });

  it('accepts every required field and inclusive nonnegative board bounds', () => {
    expect(autoLayoutSchema.parse(AUTO_LAYOUT)).toEqual(AUTO_LAYOUT);
    expect(
      autoLayoutSchema.safeParse({
        ...AUTO_LAYOUT,
        gap: BOARD_BOUND,
        padding: { ...AUTO_LAYOUT.padding, top: BOARD_BOUND },
      }).success,
    ).toBe(true);
    expect(layoutChildSchema.parse(LAYOUT_CHILD)).toEqual(LAYOUT_CHILD);
  });

  it('refuses missing fields, out-of-bound or nonfinite numbers, negative padding, unknown values, and extra keys', () => {
    const withoutJustify: Record<string, unknown> = { ...AUTO_LAYOUT };
    delete withoutJustify.justify;
    expect(autoLayoutSchema.safeParse(withoutJustify).success).toBe(false);
    for (const invalid of [
      // A negative gap overlaps the children; past minus the board bound it is refused.
      { ...AUTO_LAYOUT, gap: -BOARD_BOUND - 1 },
      { ...AUTO_LAYOUT, gap: Number.POSITIVE_INFINITY },
      { ...AUTO_LAYOUT, gap: BOARD_BOUND + 1 },
      { ...AUTO_LAYOUT, justify: 'around' },
      { ...AUTO_LAYOUT, padding: { ...AUTO_LAYOUT.padding, left: -1 } },
      { ...AUTO_LAYOUT, padding: { ...AUTO_LAYOUT.padding, right: BOARD_BOUND + 1 } },
      { ...AUTO_LAYOUT, padding: { ...AUTO_LAYOUT.padding, extra: 1 } },
      { ...AUTO_LAYOUT, extra: true },
    ])
      expect(autoLayoutSchema.safeParse(invalid).success).toBe(false);
    expect(layoutChildSchema.safeParse({ fill: true, extra: true }).success).toBe(false);
    expect(layoutChildSchema.safeParse({}).success).toBe(false);
  });

  it('accepts optional layout fields only on their specified objects and preserves older objects', () => {
    const frame = sampleObject('frame', 'frame-plan');
    const shape = sampleObject('shape', 'shape-box');
    expect(frameObjectSchema.safeParse(frame).success).toBe(true);
    expect(shapeObjectSchema.safeParse(shape).success).toBe(true);
    expect(frameObjectSchema.safeParse({ ...frame, autoLayout: AUTO_LAYOUT }).success).toBe(true);
    expect(
      componentObjectSchema.safeParse({
        ...sampleObject('component', 'component-card'),
        autoLayout: AUTO_LAYOUT,
      }).success,
    ).toBe(true);
    for (const type of [
      'text',
      'sticky',
      'image',
      'video',
      'shape',
      'frame',
      'component',
      'instance',
    ] as const) {
      expect(
        boardObjectSchema.safeParse({
          ...sampleObject(type, `sample-${type}`),
          layoutChild: LAYOUT_CHILD,
        }).success,
      ).toBe(true);
    }
    for (const type of ['line', 'path', 'connector', 'comment', 'group'] as const) {
      expect(
        boardObjectSchema.safeParse({
          ...sampleObject(type, `sample-${type}`),
          layoutChild: LAYOUT_CHILD,
        }).success,
      ).toBe(false);
    }
    expect(shapeObjectSchema.safeParse({ ...shape, autoLayout: AUTO_LAYOUT }).success).toBe(false);
    expect(
      instanceObjectSchema.safeParse({
        ...sampleObject('instance', 'instance-card'),
        isWidthFixed: true,
        isHeightFixed: false,
      }).success,
    ).toBe(true);
    expect(
      instanceObjectSchema.safeParse({
        ...sampleObject('instance', 'instance-card'),
      }).success,
    ).toBe(true);
    expect(
      stickyObjectSchema.safeParse({
        ...sampleObject('sticky', 'sticky-idea'),
        layoutChild: { fill: false },
      }).success,
    ).toBe(true);
  });

  it('validates measuredSize strictly and offers it only for text and sticky source children', () => {
    expect(
      overrideRecordSchema.safeParse({ measuredSize: { width: 0, height: 20, fonts: 'Inter' } })
        .success,
    ).toBe(true);
    expect(
      overrideRecordSchema.safeParse({
        measuredSize: { width: BOARD_BOUND, height: 0, fonts: 'x'.repeat(64) },
      }).success,
    ).toBe(true);
    for (const measuredSize of [
      { width: -1, height: 2 },
      { width: Number.POSITIVE_INFINITY, height: 2 },
      { width: 1, height: 2, fonts: '' },
      { width: 1, height: 2, fonts: 'x'.repeat(65) },
      { width: 1, height: 2, extra: true },
    ])
      expect(overrideRecordSchema.safeParse({ measuredSize }).success).toBe(false);
    expect(instanceOverrideFields(sampleObject('text', 'text-title'))).toContain('measuredSize');
    expect(instanceOverrideFields(sampleObject('sticky', 'sticky-idea'))).toContain('measuredSize');
    for (const type of ['shape', 'connector', 'path', 'line', 'image', 'frame'] as const) {
      expect(instanceOverrideFields(sampleObject(type, `sample-${type}`))).not.toContain(
        'measuredSize',
      );
    }
    expect(
      textObjectSchema.safeParse({
        ...sampleObject('text', 'text-title'),
        layoutChild: LAYOUT_CHILD,
      }).success,
    ).toBe(true);
  });
});
