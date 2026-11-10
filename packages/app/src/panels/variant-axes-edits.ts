import { MAX_VARIANT_NAME, type VariantAxis } from '@canvas/schema';

// The Variants section's edits of a main's axes, each the whole new list that one
// `setVariantAxes` stores, with the rename that keeps presets and instances' choices. Pure.

/** One edit: the whole new axes list, and a rename when a name changed. */
export interface AxesEdit {
  /** The new list. */
  readonly axes: VariantAxis[];
  /** The rename, so presets and instances' choices follow. */
  readonly renames?: {
    readonly axes?: readonly { readonly from: string; readonly to: string }[];
    readonly values?: readonly {
      readonly axis: string;
      readonly from: string;
      readonly to: string;
    }[];
  };
}

/** The axes "Add variants" creates: one `state` axis with a default and one more value. */
export const FIRST_AXES: readonly VariantAxis[] = [
  { name: 'state', values: ['default', 'variant 2'] },
];

/**
 * Whether a name may be committed beside its siblings: not blank, no `=`, no leading or trailing
 * space, within the schema's length, and not another sibling's.
 *
 * @param name - The name typed.
 * @param siblings - The other names it must differ from.
 * @returns Whether it is accepted.
 */
export function isVariantName(name: string, siblings: readonly string[]): boolean {
  return (
    name.trim() === name &&
    name.length > 0 &&
    name.length <= MAX_VARIANT_NAME &&
    !name.includes('=') &&
    !siblings.includes(name)
  );
}

/**
 * The first `<prefix> N` no sibling has, counting from the number after the siblings'.
 *
 * @param prefix - `value` or `axis`.
 * @param siblings - The names in use.
 * @returns The name.
 */
export function nextVariantName(prefix: string, siblings: readonly string[]): string {
  let index = siblings.length + 1;
  while (siblings.includes(`${prefix} ${String(index)}`)) index += 1;
  return `${prefix} ${String(index)}`;
}

/**
 * A copy of the list, which the command takes as its own.
 *
 * @param axes - The list.
 * @returns The copy.
 */
function copied(axes: readonly VariantAxis[]): VariantAxis[] {
  return axes.map(({ name, values }) => ({ name, values: [...values] }));
}

/**
 * The list with one axis replaced.
 *
 * @param axes - The list.
 * @param index - The axis's place.
 * @param axis - Its replacement.
 * @returns The new list.
 */
function withAxis(axes: readonly VariantAxis[], index: number, axis: VariantAxis): VariantAxis[] {
  return copied(axes).map((each, at) => (at === index ? axis : each));
}

/**
 * Appends `value N` to an axis.
 *
 * @param axes - The list.
 * @param index - The axis's place.
 * @returns The edit.
 */
export function addValue(axes: readonly VariantAxis[], index: number): AxesEdit {
  const axis = axes[index];
  if (axis === undefined) return { axes: copied(axes) };
  const values = [...axis.values, nextVariantName('value', axis.values)];
  return { axes: withAxis(axes, index, { ...axis, values }) };
}

/**
 * Renames an axis's value, so its preset and instances choosing it follow.
 *
 * @param axes - The list.
 * @param index - The axis's place.
 * @param from - The value's name.
 * @param to - Its new name.
 * @returns The edit.
 */
export function renameValue(
  axes: readonly VariantAxis[],
  index: number,
  from: string,
  to: string,
): AxesEdit {
  const axis = axes[index];
  if (axis === undefined) return { axes: copied(axes) };
  const values = axis.values.map((value) => (value === from ? to : value));
  return {
    axes: withAxis(axes, index, { ...axis, values }),
    renames: { values: [{ axis: axis.name, from, to }] },
  };
}

/**
 * Removes an axis's value, and its preset; instances choosing it show the default.
 *
 * @param axes - The list.
 * @param index - The axis's place.
 * @param value - The value.
 * @returns The edit.
 */
export function removeValue(axes: readonly VariantAxis[], index: number, value: string): AxesEdit {
  const axis = axes[index];
  if (axis === undefined) return { axes: copied(axes) };
  const values = axis.values.filter((each) => each !== value);
  return { axes: withAxis(axes, index, { ...axis, values }) };
}

/**
 * Moves an axis's value first, making it the default.
 *
 * @param axes - The list.
 * @param index - The axis's place.
 * @param value - The value.
 * @returns The edit.
 */
export function makeDefault(axes: readonly VariantAxis[], index: number, value: string): AxesEdit {
  const axis = axes[index];
  if (axis === undefined) return { axes: copied(axes) };
  const values = [value, ...axis.values.filter((each) => each !== value)];
  return { axes: withAxis(axes, index, { ...axis, values }) };
}

/**
 * Renames an axis, so its presets and instances' choices follow.
 *
 * @param axes - The list.
 * @param index - The axis's place.
 * @param to - Its new name.
 * @returns The edit.
 */
export function renameAxis(axes: readonly VariantAxis[], index: number, to: string): AxesEdit {
  const axis = axes[index];
  if (axis === undefined) return { axes: copied(axes) };
  return {
    axes: withAxis(axes, index, { ...axis, name: to }),
    renames: { axes: [{ from: axis.name, to }] },
  };
}

/**
 * Appends `axis N` with one value, `default`.
 *
 * @param axes - The list.
 * @returns The edit.
 */
export function addAxis(axes: readonly VariantAxis[]): AxesEdit {
  const name = nextVariantName(
    'axis',
    axes.map(({ name: each }) => each),
  );
  return { axes: [...copied(axes), { name, values: ['default'] }] };
}

/**
 * Removes an axis and its presets.
 *
 * @param axes - The list.
 * @param index - The axis's place.
 * @returns The edit.
 */
export function removeAxis(axes: readonly VariantAxis[], index: number): AxesEdit {
  return { axes: copied(axes).filter((each, at) => at !== index) };
}
