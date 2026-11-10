import { describe, expect, it } from 'vitest';

import { applyInstanceOverride, instanceOverrideFields } from '../instances/override-content.js';

import { boardObjectSchema } from './board-object.js';
import {
  findFreehandIssues,
  freehandObjectSchema,
  MAX_FREEHAND_POINTS,
} from './freehand-object.js';

const STROKE = {
  id: 'stroke-1',
  type: 'freehand',
  parentId: null,
  x: 10,
  y: 20,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada',
  createdAt: 1_767_225_600_000,
  updatedAt: 1_767_225_600_000,
  tool: 'marker',
  points: [0, 0, 10, 5, 20, 0],
  pressures: [0.2, 0.8, 0.4],
  stroke: { color: 'ink', width: 6 },
} as const;

describe('freehandObjectSchema', () => {
  it('accepts a pressured marker stroke, a dot and a translucent highlighter', () => {
    expect(freehandObjectSchema.safeParse(STROKE).success).toBe(true);
    expect(boardObjectSchema.safeParse(STROKE).success).toBe(true);
    const dot = { ...STROKE, tool: 'pencil', points: [1, 1], pressures: undefined };
    expect(freehandObjectSchema.safeParse(dot).success).toBe(true);
    const highlight = { ...STROKE, tool: 'highlighter', opacity: 0.4, pressures: undefined };
    expect(freehandObjectSchema.safeParse(highlight).success).toBe(true);
  });

  it.each([
    ['an odd count', { points: [0, 0, 1], pressures: undefined }],
    ['no points', { points: [], pressures: undefined }],
    ['a pressure per point missing', { pressures: [0.5] }],
    ['a pressure above 1', { pressures: [0.2, 1.2, 0.4] }],
    ['an unknown tool', { tool: 'crayon' }],
    ['an unknown key', { smoothing: 0.5 }],
    ['a zero width', { stroke: { color: 'ink', width: 0 } }],
    ['a non-finite point', { points: [0, 0, Number.POSITIVE_INFINITY, 0, 20, 0] }],
  ])('refuses %s', (name, change) => {
    expect(freehandObjectSchema.safeParse({ ...STROKE, ...change }).success).toBe(false);
  });

  it('refuses more than the most points', () => {
    const points = Array.from({ length: 2 * (MAX_FREEHAND_POINTS + 1) }, (unused, index) => index);
    expect(
      freehandObjectSchema.safeParse({ ...STROKE, points, pressures: undefined }).success,
    ).toBe(false);
  });
});

describe('findFreehandIssues', () => {
  it('names each issue', () => {
    expect(findFreehandIssues([0, 0], undefined)).toEqual([]);
    expect(findFreehandIssues([0, 0, 1], [1, 1])).toHaveLength(2);
  });
});

describe('a freehand stroke as an instance child', () => {
  it('takes its layer fields, a stroke colour and a place as overrides', () => {
    const object = freehandObjectSchema.parse(STROKE);
    expect(instanceOverrideFields(object)).toEqual(
      expect.arrayContaining(['strokeColor', 'x', 'y', 'isHidden']),
    );
    expect(instanceOverrideFields(object)).not.toContain('width');
    const recoloured = applyInstanceOverride(object, { strokeColor: [1, 0, 0, 1] });
    expect(recoloured).toMatchObject({ stroke: { color: [1, 0, 0, 1], width: 6 } });
  });
});
