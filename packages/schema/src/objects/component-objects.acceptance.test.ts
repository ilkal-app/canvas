import { describe, expect, it } from 'vitest';

import type { Board } from '../board/board.js';
import {
  BODY,
  boardOf,
  component,
  instance,
  instanceChain,
  shape,
  sticky,
} from '../instances/__fixtures__/component-board.js';
import { expectedExport } from '../instances/__fixtures__/expected-api.js';
import { MIGRATIONS } from '../migrations/migration-registry.js';
import { DEFAULT_PAGE } from '../pages/page.js';
import { createFixtureBoard } from '../portable/__fixtures__/fixture-board.js';
import { exportBoard } from '../portable/export-board.js';
import { importBoard } from '../portable/import-board.js';
import { portableBoardSchema } from '../portable/portable-board.js';
import { validateBoard } from '../rules/validate-board.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { boardObjectSchema } from './board-object.js';
import { OBJECT_TYPES } from './object-type.js';

// Acceptance, first slice: the component
// and instance object schemas, constraints, the new validateBoard codes, the limits, schema
// version 4 and the portable round trip.

/**
 * Whether a value passes `boardObjectSchema`.
 *
 * @param value - The value.
 * @returns `true` when it parses.
 */
function parses(value: unknown): boolean {
  return boardObjectSchema.safeParse(value).success;
}

/**
 * The code and object of every issue, for comparing against a short list.
 *
 * @param board - The board to validate.
 * @returns `[code, objectId]` pairs, as `validateBoard` orders them.
 */
function issuePairs(board: Board): [string, string | null][] {
  return validateBoard(board).map((issue) => [issue.code, issue.objectId]);
}

const RED: [number, number, number, number] = [1, 0, 0, 1];

/**
 * A copy of a fixture object without one of its fields.
 *
 * @param object - The object.
 * @param key - The field to leave out.
 * @returns The copy.
 */
function without(object: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
}

describe('component and instance objects', () => {
  it('lists component and instance among the object types', () => {
    expect(OBJECT_TYPES).toContain('component');
    expect(OBJECT_TYPES).toContain('instance');
  });

  it('parses the fixture component and instance unchanged', () => {
    const main = component('main');
    const inst = instance('inst', 'main', { overrides: { 'child-a': { fill: RED } } });
    expect(boardObjectSchema.parse(main)).toEqual(main);
    expect(boardObjectSchema.parse(inst)).toEqual(inst);
    expect(expectedExport('componentObjectSchema').safeParse(main).success).toBe(true);
    expect(expectedExport('instanceObjectSchema').safeParse(inst).success).toBe(true);
  });

  it('refuses an unknown key on a component and on an instance', () => {
    expect(parses(component('main', { extra: 1 }))).toBe(false);
    expect(parses(instance('inst', 'main', { extra: 1 }))).toBe(false);
  });

  it('refuses an instance without a mainId', () => {
    expect(parses(without(instance('inst', 'main'), 'mainId'))).toBe(false);
    expect(parses(instance('inst', 'main', { mainId: 'not an id' }))).toBe(false);
  });

  it('refuses a component whose retired is not a boolean', () => {
    expect(parses(component('main', { retired: 'yes' }))).toBe(false);
    expect(parses(component('main', { retired: 0 }))).toBe(false);
    expect(parses(without(component('main'), 'retired'))).toBe(false);
  });

  it('refuses an override record with no field', () => {
    expect(parses(instance('inst', 'main', { overrides: { 'child-a': {} } }))).toBe(false);
    expect(expectedExport('overrideRecordSchema').safeParse({}).success).toBe(false);
    expect(expectedExport('instanceOverridesSchema').safeParse({ 'child-a': {} }).success).toBe(
      false,
    );
  });

  it.each([
    // A child's x, y, width and height became record fields with; its rotation and
    // stacking still are not.
    ['rotation', 1],
    ['parentId', null],
    ['constraints', { x: 'start', y: 'start' }],
    ['z', 'a1'],
    ['runs', [{ length: 1, style: BODY }]],
    ['label', { text: 'B', runs: [{ length: 1, style: BODY }] }],
    ['stroke', { color: RED, width: 4 }],
    ['fontSize', 40],
    ['fill', { kind: 'linear' }],
  ])(
    'refuses an override record with the key %s, outside the ticket’s override scope',
    (key, value) => {
      const record = { fill: RED, [key]: value };
      expect(expectedExport('overrideRecordSchema').safeParse(record).success).toBe(false);
      expect(parses(instance('inst', 'main', { overrides: { 'child-a': record } }))).toBe(false);
    },
  );

  it('refuses an override path of six segments or with a character outside an id', () => {
    const overridePathSchema = expectedExport('overridePathSchema');
    expect(overridePathSchema.safeParse('a/b/c/d/e').success).toBe(true);
    expect(overridePathSchema.safeParse('a/b/c/d/e/f').success).toBe(false);
    expect(overridePathSchema.safeParse('child a').success).toBe(false);
    expect(overridePathSchema.safeParse('child.a').success).toBe(false);
    expect(overridePathSchema.safeParse('').success).toBe(false);
    const hidden = { isHidden: true };
    expect(parses(instance('inst', 'main', { overrides: { 'a/b/c/d/e': hidden } }))).toBe(true);
    expect(parses(instance('inst', 'main', { overrides: { 'a/b/c/d/e/f': hidden } }))).toBe(false);
    expect(parses(instance('inst', 'main', { overrides: { 'child a': hidden } }))).toBe(false);
  });
});

describe('constraints', () => {
  it('names the four modes in order', () => {
    expect(expectedExport('CONSTRAINT_MODES')).toEqual(['start', 'center', 'end', 'stretch']);
  });

  it('accepts the four modes on each axis and refuses any other', () => {
    const constraintsSchema = expectedExport('constraintsSchema');
    for (const mode of ['start', 'center', 'end', 'stretch']) {
      expect(constraintsSchema.safeParse({ x: mode, y: mode }).success).toBe(true);
    }
    expect(constraintsSchema.safeParse({ x: 'left', y: 'start' }).success).toBe(false);
    expect(constraintsSchema.safeParse({ x: 'start', y: 'middle' }).success).toBe(false);
    expect(constraintsSchema.safeParse({ x: 'start' }).success).toBe(false);
    expect(constraintsSchema.safeParse({ x: 'start', y: 'start', z: 'start' }).success).toBe(false);
  });

  it('parses a child with constraints and a child without them', () => {
    const constrained = shape('child-a', 'main', { constraints: { x: 'stretch', y: 'end' } });
    expect(boardObjectSchema.parse(constrained)).toEqual(constrained);
    const plain = shape('child-b', 'main');
    expect(boardObjectSchema.parse(plain)).toEqual(plain);
    expect(boardObjectSchema.parse(plain)).not.toHaveProperty('constraints');
    expect(parses(shape('child-c', 'main', { constraints: { x: 'stretch' } }))).toBe(false);
  });

  it('answers start/start for an object without constraints and the stored ones otherwise', () => {
    const effectiveConstraints = expectedExport('effectiveConstraints');
    expect(effectiveConstraints(shape('child-a', 'main'))).toEqual({ x: 'start', y: 'start' });
    expect(effectiveConstraints(shape('child-a', 'main'))).toEqual(
      expectedExport('DEFAULT_CONSTRAINTS'),
    );
    const constraints = { x: 'center', y: 'stretch' };
    expect(effectiveConstraints(shape('child-b', 'main', { constraints }))).toEqual(constraints);
  });

  it('freezes the default constraints', () => {
    const defaults = expectedExport('DEFAULT_CONSTRAINTS');
    expect(defaults).toEqual({ x: 'start', y: 'start' });
    expect(Object.isFrozen(defaults)).toBe(true);
  });
});

describe('validateBoard', () => {
  it('admits a component as a parent', () => {
    const board = boardOf([
      component('main'),
      shape('child-a', 'main', { constraints: { x: 'end', y: 'start' } }),
      sticky('sticky', 'main'),
    ]);
    expect(validateBoard(board)).toEqual([]);
  });

  it('reports an instance whose main is not on the board as missing-main', () => {
    expect(issuePairs(boardOf([instance('inst', 'gone')]))).toEqual([['missing-main', 'inst']]);
  });

  it('reports an instance whose main is a sticky as invalid-main', () => {
    const board = boardOf([sticky('note', null), instance('inst', 'note')]);
    expect(issuePairs(board)).toEqual([['invalid-main', 'inst']]);
  });

  it('reports instance-cycle on the instances when two mains contain instances of each other', () => {
    const board = boardOf([
      component('main-a'),
      component('main-b', { x: 300 }),
      instance('nb', 'main-b', { parentId: 'main-a' }),
      instance('na', 'main-a', { parentId: 'main-b' }),
    ]);
    expect(issuePairs(board)).toEqual([
      ['instance-cycle', 'na'],
      ['instance-cycle', 'nb'],
    ]);
  });

  it('reports instance-depth on a chain of six instances and nothing on a chain of five', () => {
    expect(issuePairs(boardOf(instanceChain(5)))).toEqual([]);
    expect(issuePairs(boardOf(instanceChain(6)))).toEqual([['instance-depth', 'inst']]);
  });
});

describe('limits and schema version', () => {
  it('holds 10,000 instances and 5 levels as the limits', () => {
    expect(expectedExport('MAX_INSTANCES')).toBe(10_000);
    expect(expectedExport('MAX_INSTANCE_DEPTH')).toBe(5);
  });

  it('is schema version 4 or later (raised it to 5)', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
  });

  it('has a migration step 4 that is the identity on a version 3 document', () => {
    const document = JSON.parse(
      JSON.stringify({ ...exportBoard(createFixtureBoard()), schemaVersion: 3 }),
    ) as { schemaVersion: number };
    const before = structuredClone(document);
    const step = MIGRATIONS.get(4);
    expect(step).toBeDefined();
    expect(step?.(document)).toEqual(before);
    expect(document).toEqual(before);
  });
});

describe('portable boards', () => {
  it('round-trips a component, an instance with two override paths and a constrained child', () => {
    const board = boardOf(
      [
        component('main', { pageId: DEFAULT_PAGE.id }),
        shape('child-a', 'main', { x: 30, y: 10, constraints: { x: 'stretch', y: 'end' } }),
        sticky('sticky', 'main', { x: 30, y: 40 }),
        instance('inst', 'main', {
          x: 500,
          pageId: DEFAULT_PAGE.id,
          overrides: {
            'child-a': { fill: RED, strokeColor: RED },
            sticky: { text: 'Hi', color: RED },
          },
        }),
      ],
      [{ ...DEFAULT_PAGE }],
    );
    const json = exportBoard(board);
    expect(json.schemaVersion).toBe(SCHEMA_VERSION);
    expect(portableBoardSchema.safeParse(json).success).toBe(true);
    expect(importBoard(json)).toEqual(board);
    expect(importBoard(JSON.parse(JSON.stringify(json)))).toEqual(board);
  });

  it('still imports a version 3 board, whose objects then have no constraints property', () => {
    const json = JSON.parse(
      JSON.stringify({ ...exportBoard(createFixtureBoard()), schemaVersion: 3 }),
    ) as unknown;
    const board = importBoard(json);
    expect(board.objects.size).toBe(createFixtureBoard().objects.size);
    for (const object of board.objects.values()) {
      expect(object).not.toHaveProperty('constraints');
    }
  });
});
