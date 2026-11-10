// Paint on a stored slot child survives a main swap by layer-name path.
import { describe, expect, it } from 'vitest';

import { resolveInstance } from '@canvas/schema';

import { boardOf, component, group, instance, path } from './__fixtures__/component-board.js';

const CARRIED = [0.5, 0.5, 0.5, 1] as const;
const STORED = [0.1, 0.1, 0.12, 1] as const;
const RED = [1, 0, 0, 1] as const;
const FRAME_PATHS = ['frame-top', 'frame-right', 'frame-bottom', 'frame-left'] as const;

/**
 * Makes the two icons and an enclosing main with one stored icon slot.
 *
 * @param hasPreset - Whether the main has the default paint preset.
 * @returns Source objects for a button and both icons.
 */
function icons(hasPreset = true) {
  const button = component('button', {
    variantAxes: [{ name: 'state', values: ['default', 'active'] }],
    variantPresets: hasPreset
      ? { 'state=default': { 'slot/select-path': { strokeColor: CARRIED } } }
      : {},
  });
  return [
    component('icon-select'),
    path('select-path', 'icon-select', { name: 'path' }),
    component('icon-frame'),
    ...FRAME_PATHS.map((id, index) =>
      path(id, 'icon-frame', { name: 'path', z: `a${String(index)}` }),
    ),
    button,
    instance('slot', 'icon-select', { parentId: 'button' }),
  ];
}

/**
 * Resolves one placed button with the given records and source objects.
 *
 * @param overrides - The placed instance's own records.
 * @param hasPreset - Whether the default sources carry a preset.
 * @param sources - The main definitions and their children.
 * @returns The placed button's virtual objects.
 */
function resolved(
  overrides: Record<string, unknown> = { slot: { mainId: 'icon-frame' } },
  hasPreset = true,
  sources: readonly object[] = icons(hasPreset),
) {
  const placed = instance('placed', 'button', { variant: { state: 'default' }, overrides });
  return resolveInstance(boardOf([...sources, placed]), placed).objects;
}

/**
 * Reads the resolved stroke colour of one source child.
 *
 * @param objects - The resolved virtual objects.
 * @param childId - The source path's id.
 * @returns The resolved stroke colour.
 * @throws {Error} If the path or its stroke is absent.
 */
function colour(objects: ReturnType<typeof resolved>, childId: string) {
  const object = objects.find(({ id }) => id === `placed/slot/${childId}`);
  expect(object?.type).toBe('path');
  if (object?.type !== 'path') throw new Error(`missing path ${childId}`);
  if (object.stroke === null) throw new Error(`missing stroke ${childId}`);
  return object.stroke.color;
}

describe('swapped slot override names', () => {
  it('carries the enclosing main default preset to every matching swapped path', () => {
    const objects = resolved();
    for (const id of FRAME_PATHS) expect(colour(objects, id)).toEqual(CARRIED);
  });

  // Only presets carry: an own record stays at the path it was written to,
  // where reset and the inspector find it.
  it('leaves an enclosing instance own record at its stored path', () => {
    const objects = resolved(
      { slot: { mainId: 'icon-frame' }, 'slot/select-path': { strokeColor: CARRIED } },
      false,
    );
    for (const id of FRAME_PATHS) expect(colour(objects, id)).toEqual(STORED);
  });

  it('lets a target id record win per field over a carried record', () => {
    const sources = icons().map((source) =>
      'id' in source && source.id === 'button'
        ? {
            ...source,
            variantPresets: {
              'state=default': { 'slot/select-path': { strokeColor: CARRIED, opacity: 0.4 } },
            },
          }
        : source,
    );
    const objects = resolved(
      { slot: { mainId: 'icon-frame' }, 'slot/frame-top': { strokeColor: RED } },
      true,
      sources,
    );
    expect(colour(objects, 'frame-top')).toEqual(RED);
    expect(objects.find(({ id }) => id === 'placed/slot/frame-top')).toMatchObject({
      opacity: 0.4,
    });
    for (const id of FRAME_PATHS.slice(1)) expect(colour(objects, id)).toEqual(CARRIED);
  });

  it('keeps the stored icon and its preset when the slot is not swapped', () => {
    const objects = resolved({});
    expect(colour(objects, 'select-path')).toEqual(CARRIED);
    for (const id of FRAME_PATHS)
      expect(objects.some((object) => object.id === `placed/slot/${id}`)).toBe(false);
  });

  it('ignores a source name path with no match in the swapped main', () => {
    const sources = [
      component('icon-select'),
      path('select-path', 'icon-select', { name: 'path' }),
      component('icon-frame'),
      path('frame-top', 'icon-frame', { name: 'outline' }),
      component('button', {
        variantAxes: [{ name: 'state', values: ['default', 'active'] }],
        variantPresets: { 'state=default': { 'slot/select-path': { strokeColor: CARRIED } } },
      }),
      instance('slot', 'icon-select', { parentId: 'button' }),
    ];
    const objects = resolved(undefined, true, sources);
    expect(colour(objects, 'frame-top')).toEqual(STORED);
    expect(objects.filter(({ type }) => type === 'path')).toHaveLength(1);
  });

  it('matches the full nested name path, not only the leaf name', () => {
    const sources = [
      component('icon-select'),
      group('old-group', 'icon-select', { name: 'g' }),
      path('select-path', 'old-group', { name: 'path' }),
      component('icon-frame'),
      group('new-group', 'icon-frame', { name: 'g' }),
      path('nested-path', 'new-group', { name: 'path' }),
      path('top-path', 'icon-frame', { name: 'path' }),
      component('button', {
        variantAxes: [{ name: 'state', values: ['default', 'active'] }],
        variantPresets: { 'state=default': { 'slot/select-path': { strokeColor: CARRIED } } },
      }),
      instance('slot', 'icon-select', { parentId: 'button' }),
    ];
    const objects = resolved(undefined, true, sources);
    expect(colour(objects, 'nested-path')).toEqual(CARRIED);
    expect(colour(objects, 'top-path')).toEqual(STORED);
  });

  it('applies only fields supported by the matching target type', () => {
    const sources = [
      component('icon-select'),
      path('select-path', 'icon-select', { name: 'path' }),
      component('icon-frame'),
      group('frame-group', 'icon-frame', { name: 'path' }),
      component('button', {
        variantAxes: [{ name: 'state', values: ['default', 'active'] }],
        variantPresets: {
          'state=default': { 'slot/select-path': { strokeColor: CARRIED, opacity: 0.4 } },
        },
      }),
      instance('slot', 'icon-select', { parentId: 'button' }),
    ];
    const objects = resolved(undefined, true, sources);
    const target = objects.find(({ id }) => id === 'placed/slot/frame-group');
    expect(target).toMatchObject({ type: 'group', opacity: 0.4 });
    expect(target).not.toHaveProperty('stroke');
  });

  it('leaves a target id record active when its name does not match', () => {
    const sources = icons().map((source) =>
      'id' in source && source.id === 'frame-top' ? { ...source, name: 'outline' } : source,
    );
    const objects = resolved(
      { slot: { mainId: 'icon-frame' }, 'slot/frame-top': { strokeColor: RED } },
      true,
      sources,
    );
    expect(colour(objects, 'frame-top')).toEqual(RED);
  });

  it('keeps the stored icon preset when the swap target cannot expand', () => {
    const objects = resolved({ slot: { mainId: 'missing-icon' } });
    expect(colour(objects, 'select-path')).toEqual(CARRIED);
  });

  it('returns the same result twice without changing its inputs', () => {
    const sources = icons();
    const placed = instance('placed', 'button', {
      variant: { state: 'default' },
      overrides: { slot: { mainId: 'icon-frame' } },
    });
    const board = boardOf([...sources, placed]);
    const before = structuredClone([...board.objects.values()]);
    const placedBefore = structuredClone(placed);
    const first = resolveInstance(board, placed);
    expect(resolveInstance(board, placed)).toEqual(first);
    expect([...board.objects.values()]).toEqual(before);
    expect(placed).toEqual(placedBefore);
    for (const id of FRAME_PATHS) expect(colour(first.objects, id)).toEqual(CARRIED);
  });
});
