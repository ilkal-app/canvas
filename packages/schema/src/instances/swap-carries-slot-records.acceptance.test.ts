// A nested slot's own definition records colour a swapped main when drawing.
import { describe, expect, it } from 'vitest';

import { resolveInstance } from '@canvas/schema';

import { boardOf, component, group, id, instance, path } from './__fixtures__/component-board.js';
import { slotExpansion } from './slot-expansion.js';

const SLOT_COLOUR = [0.5, 0.5, 0.5, 1] as const;
const PRESET_COLOUR = [0.2, 0.4, 0.6, 1] as const;
const TARGET_COLOUR = [1, 0, 0, 1] as const;
const FRAME_PATHS = ['frame-top', 'frame-right', 'frame-bottom', 'frame-left'] as const;

/**
 * Builds the run-7 mains: an empty default preset and a coloured record on the icon slot.
 *
 * @param slotOverrides - Records stored on the nested slot definition.
 * @param preset - Records in the button's default variant.
 * @returns The button and icon definitions.
 */
function sources(
  slotOverrides: Record<string, unknown> = { 'select-path': { strokeColor: SLOT_COLOUR } },
  preset: Record<string, unknown> = {},
) {
  return [
    component('icon-select'),
    path('select-path', 'icon-select', { name: 'Vector' }),
    component('icon-frame'),
    ...FRAME_PATHS.map((id, index) =>
      path(id, 'icon-frame', { name: 'Vector', z: `a${String(index)}` }),
    ),
    component('button', {
      variantAxes: [{ name: 'state', values: ['default', 'active'] }],
      variantPresets: { 'state=default': preset },
    }),
    instance('slot', 'icon-select', { parentId: 'button', overrides: slotOverrides }),
  ];
}

/**
 * Resolves the placed ToolButton and returns its virtual descendants.
 *
 * @param placedOverrides - Records on the placed ToolButton.
 * @param slotOverrides - Records on the main's nested slot.
 * @param preset - The button's default preset records.
 * @param definition - Optional replacement definition objects.
 * @returns The placed ToolButton's virtual descendants.
 */
function resolved(
  placedOverrides: Record<string, unknown> = { slot: { mainId: 'icon-frame' } },
  slotOverrides?: Record<string, unknown>,
  preset?: Record<string, unknown>,
  definition: readonly object[] = sources(slotOverrides, preset),
) {
  const placed = instance('placed', 'button', {
    variant: { state: 'default' },
    overrides: placedOverrides,
  });
  return resolveInstance(boardOf([...definition, placed]), placed).objects;
}

/**
 * Reads one virtual path's drawn stroke colour.
 *
 * @param objects - The resolved virtual descendants.
 * @param childId - The source path id.
 * @returns The path's stroke colour.
 * @throws {Error} When the stroked path is absent.
 */
function colour(objects: ReturnType<typeof resolved>, childId: string) {
  const object = objects.find(({ id }) => id === `placed/slot/${childId}`);
  expect(object?.type).toBe('path');
  if (object?.type !== 'path' || object.stroke === null)
    throw new Error(`missing stroked path ${childId}`);
  return object.stroke.color;
}

describe('swapped slot definition records', () => {
  it('carries the slot definition colour to every same-name path of the swapped icon', () => {
    const objects = resolved();
    for (const id of FRAME_PATHS) expect(colour(objects, id)).toEqual(SLOT_COLOUR);
  });

  it('keeps the slot definition colour on the stored icon without a swap', () => {
    const objects = resolved({});
    expect(colour(objects, 'select-path')).toEqual(SLOT_COLOUR);
    for (const id of FRAME_PATHS)
      expect(objects.some(({ id: objectId }) => objectId === `placed/slot/${id}`)).toBe(false);
  });

  it('lets a preset record win over the slot definition record at the same name path', () => {
    const objects = resolved(undefined, undefined, {
      'slot/select-path': { strokeColor: PRESET_COLOUR },
    });
    for (const id of FRAME_PATHS) expect(colour(objects, id)).toEqual(PRESET_COLOUR);
  });

  it('lets a record at a new child id win field by field over a carried slot record', () => {
    const objects = resolved(undefined, {
      'select-path': { strokeColor: SLOT_COLOUR, opacity: 0.4 },
      'frame-top': { strokeColor: TARGET_COLOUR },
    });
    expect(colour(objects, 'frame-top')).toEqual(TARGET_COLOUR);
    expect(objects.find(({ id }) => id === 'placed/slot/frame-top')).toMatchObject({
      opacity: 0.4,
    });
    for (const id of FRAME_PATHS.slice(1)) expect(colour(objects, id)).toEqual(SLOT_COLOUR);
  });

  it('leaves the placed instance own old-child record at its stored path', () => {
    const overrides = {
      slot: { mainId: 'icon-frame' },
      'slot/select-path': { strokeColor: TARGET_COLOUR },
    };
    const placed = instance('placed', 'button', {
      variant: { state: 'default' },
      overrides,
    });
    const objects = resolveInstance(boardOf([...sources(), placed]), placed).objects;
    expect(placed.overrides).toEqual(overrides);
    expect(objects.some(({ id }) => id === 'placed/slot/select-path')).toBe(false);
    for (const id of FRAME_PATHS) expect(colour(objects, id)).toEqual(SLOT_COLOUR);
  });

  it('drops carried fields that the matching target type cannot take', () => {
    const definition = [
      component('icon-select'),
      path('select-path', 'icon-select', { name: 'Vector' }),
      component('icon-frame'),
      group('frame-group', 'icon-frame', { name: 'Vector' }),
      component('button', {
        variantAxes: [{ name: 'state', values: ['default', 'active'] }],
        variantPresets: { 'state=default': {} },
      }),
      instance('slot', 'icon-select', {
        parentId: 'button',
        overrides: { 'select-path': { strokeColor: SLOT_COLOUR, opacity: 0.4 } },
      }),
    ];
    const target = resolved(undefined, undefined, undefined, definition).find(
      ({ id }) => id === 'placed/slot/frame-group',
    );
    expect(target).toMatchObject({ type: 'group', opacity: 0.4 });
    expect(target).not.toHaveProperty('stroke');
  });

  it('returns the same result twice without changing the board or placed instance', () => {
    const placed = instance('placed', 'button', {
      variant: { state: 'default' },
      overrides: { slot: { mainId: 'icon-frame' } },
    });
    const board = boardOf([...sources(), placed]);
    const before = structuredClone([...board.objects.values()]);
    const placedBefore = structuredClone(placed);
    const first = resolveInstance(board, placed);
    expect(resolveInstance(board, placed)).toEqual(first);
    expect([...board.objects.values()]).toEqual(before);
    expect(placed).toEqual(placedBefore);
  });

  it('leaves stored-record readers unchanged when they pass no drawing presets', () => {
    const definition = sources();
    const board = boardOf(definition);
    const slot = definition.find((object) => 'id' in object && object.id === 'slot');
    if (slot === undefined || !('type' in slot) || slot.type !== 'instance')
      throw new Error('missing slot fixture');
    const expanded = slotExpansion(board, slot, { slot: { mainId: id('icon-frame') } }, [
      id('button'),
    ]);
    expect(expanded.overrides).toEqual({ 'select-path': { strokeColor: SLOT_COLOUR } });
  });
});
