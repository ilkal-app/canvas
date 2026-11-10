// Freehand validation and portable schema compatibility.
import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';

const freehandObjectSchema = Reflect.get(
  schema,
  'freehandObjectSchema',
) as unknown as typeof schema.boardObjectSchema;
const FREEHAND_VERSION = Reflect.get(schema, 'FREEHAND_VERSION') as number;
const MAX_FREEHAND_POINTS = Reflect.get(schema, 'MAX_FREEHAND_POINTS') as number;

function stroke(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'freehand-one',
    type: 'freehand',
    parentId: null,
    x: 12,
    y: 20,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    tool: 'pencil',
    points: [0, 0, 10, 20],
    stroke: { color: [0, 0, 0, 1], width: 4 },
    ...overrides,
  };
}

function portable(version: number, objects: unknown[] = []): unknown {
  return { format: 'canvas.board', schemaVersion: version, objects };
}

describe('freehand object schema', () => {
  it.each(['pencil', 'marker', 'highlighter'])('accepts a %s stroke', (tool) => {
    expect(freehandObjectSchema.safeParse(stroke({ tool })).success).toBe(true);
    expect(schema.boardObjectSchema.safeParse(stroke({ tool })).success).toBe(true);
  });

  it('accepts a one-point dot, pressures, opacity, visibility and ink colour', () => {
    expect(
      freehandObjectSchema.safeParse(
        stroke({
          points: [3, 4],
          pressures: [0.5],
          opacity: 0.4,
          isHidden: true,
          stroke: { color: 'ink', width: 1 },
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    ['empty', []],
    ['odd', [0, 0, 1]],
    ['NaN', [0, Number.NaN]],
    ['infinity', [Number.POSITIVE_INFINITY, 0]],
  ])('refuses %s points', (name, points) => {
    expect(freehandObjectSchema.safeParse(stroke({ points })).success).toBe(false);
  });

  it('refuses more than MAX_FREEHAND_POINTS samples', () => {
    expect(MAX_FREEHAND_POINTS).toBe(1024);
    expect(
      freehandObjectSchema.safeParse(
        stroke({ points: Array.from({ length: (MAX_FREEHAND_POINTS + 1) * 2 }, (unused, i) => i) }),
      ).success,
    ).toBe(false);
  });

  it.each([[[]], [[0.5]], [[-0.01, 0.5]], [[0.5, 1.01]], [[0.5, Number.NaN]]])(
    'refuses invalid pressures %j',
    (pressures) => {
      expect(freehandObjectSchema.safeParse(stroke({ pressures })).success).toBe(false);
    },
  );

  it.each([
    { tool: 'brush' },
    { extra: true },
    { stroke: { color: 'ink', width: 0 } },
    { stroke: { color: 'ink', width: 65 } },
  ])('refuses invalid freehand fields %j', (change) => {
    expect(freehandObjectSchema.safeParse(stroke(change)).success).toBe(false);
  });

  it('registers freehand after path and advances the schema with migration 31 to 32', () => {
    expect((schema.OBJECT_TYPES as readonly string[]).indexOf('freehand')).toBe(
      schema.OBJECT_TYPES.indexOf('path') + 1,
    );
    expect(FREEHAND_VERSION).toBe(32);
    expect(schema.SCHEMA_VERSION).toBeGreaterThanOrEqual(32);
    expect(schema.MIGRATIONS.has(32)).toBe(true);
    expect(schema.importBoard(portable(31)).objects.size).toBe(0);
  });

  it('round-trips a portable freehand without losing points or pressure', () => {
    const first = schema.importBoard(portable(30, [stroke({ pressures: [0.25, 0.75] })]));
    const exported = schema.exportBoard(first);
    expect([...first.objects.values()][0]).toMatchObject(stroke({ pressures: [0.25, 0.75] }));
    expect(schema.exportBoard(schema.importBoard(exported))).toEqual(exported);
  });
});
