// A swapped slot's carried records match an unnamed nested instance by its main's name,
// and carry nothing to one whose main is missing, as it has no name to match.
import { describe, expect, it } from 'vitest';

import { resolveInstance } from '@canvas/schema';

import { boardOf, component, instance, path } from './__fixtures__/component-board.js';

/**
 * Resolves a placed button whose slot is swapped from one icon to another, each icon holding one
 * unnamed nested instance of `dotMain`, with a preset hiding the stored icon's.
 *
 * @param dotMain - The nested instances' main; absent from the board when it is `'gone'`.
 * @param options - The nested instances' name and the preset's record.
 * @param options.name - The nested instances' own name; none by default.
 * @param options.record - The preset record at the stored icon's instance; hidden by default.
 * @returns The ids of the placed button's virtual objects.
 */
function resolvedIds(
  dotMain: string,
  { name, record = { isHidden: true } }: { name?: string; record?: unknown } = {},
): string[] {
  const unnamed = { name };
  const objects = [
    ...(dotMain === 'gone' ? [] : [component(dotMain, { name: 'dot' })]),
    component('icon-a', { name: 'a' }),
    instance('dot-a', dotMain, { parentId: 'icon-a', ...unnamed }),
    component('icon-b', { name: 'b' }),
    instance('dot-b', dotMain, { parentId: 'icon-b', ...unnamed }),
    component('button', {
      name: 'button',
      variantAxes: [{ name: 'state', values: ['default'] }],
      variantPresets: { 'state=default': { 'slot/dot-a': record } },
    }),
    instance('slot', 'icon-a', { parentId: 'button' }),
  ];
  const placed = instance('placed', 'button', {
    variant: { state: 'default' },
    overrides: { slot: { mainId: 'icon-b' } },
  });
  return resolveInstance(boardOf([...objects, placed]), placed).objects.map(({ id }) => id);
}

describe('a swapped slot matches unnamed nested instances by their main', () => {
  it('carries a record to the same-named nested instance', () => {
    expect(resolvedIds('dot-main')).not.toContain('placed/slot/dot-b');
    expect(resolvedIds('dot-main')).toContain('placed/slot');
  });

  it('carries nothing to a nested instance whose main is missing', () => {
    expect(resolvedIds('gone')).toContain('placed/slot/dot-b');
  });
  it('reads an empty name as unnamed, as command name paths do', () => {
    expect(resolvedIds('dot-main', { name: '' })).not.toContain('placed/slot/dot-b');
  });

  it('carries nothing from a preset record no reader parses', () => {
    expect(resolvedIds('dot-main', { record: { isHidden: 'yes' } })).toContain('placed/slot/dot-b');
  });
  it('carries nothing to an unnamed layer that is not an instance', () => {
    const objects = [
      component('icon-a', { name: 'a' }),
      path('line-a', 'icon-a'),
      component('icon-b', { name: 'b' }),
      path('line-b', 'icon-b'),
      component('button', {
        name: 'button',
        variantAxes: [{ name: 'state', values: ['default'] }],
        variantPresets: { 'state=default': { 'slot/line-a': { isHidden: true } } },
      }),
      instance('slot', 'icon-a', { parentId: 'button' }),
    ];
    const placed = instance('placed', 'button', {
      variant: { state: 'default' },
      overrides: { slot: { mainId: 'icon-b' } },
    });
    const ids = resolveInstance(boardOf([...objects, placed]), placed).objects.map(({ id }) => id);
    expect(ids).toContain('placed/slot/line-b');
  });
});
