import type { BoardObject, ColorMode, InstanceObject } from '@canvas/schema';

// An instance as the scene shows it (a main's own colour mode applies to
// its content and to instances that set none). The scene resolves the colours of an instance's
// virtual content by walking up to the instance, and the instance's main is often on another page
// (or, in a worker, nowhere the scene can read), so the expansion, which reads the whole board's
// definitions when it resolves an instance, hands the main's mode down on the shown instance.
// Only the scene's colour walk reads it; a main's mode change re-resolves its instances (`mainKey`).

/**
 * An object's own explicit colour mode, read defensively.
 *
 * @param object - Any object.
 * @returns `'light'`, `'dark'` or undefined.
 */
function explicitMode(object: BoardObject | undefined): ColorMode | undefined {
  const mode = (object as { readonly colorMode?: unknown } | undefined)?.colorMode;
  return mode === 'light' || mode === 'dark' ? mode : undefined;
}

/**
 * The mode a main hands to its instances that set none.
 *
 * @param main - The referenced object, if the board has it.
 * @returns A component's own mode, or undefined.
 */
export function mainColorModeOf(main: BoardObject | undefined): ColorMode | undefined {
  return main?.type === 'component' ? explicitMode(main) : undefined;
}

/**
 * An instance as the scene shows it: itself when it sets a `colorMode` or its main sets none;
 * otherwise a copy carrying its main's mode. Pure.
 *
 * @param instance - The instance, stored or virtual (a nested instance's copy).
 * @param mainMode - Its main's mode ({@link mainColorModeOf}).
 * @returns The instance to show.
 */
export function withMainColorMode<Instance extends BoardObject>(
  instance: Instance,
  mainMode: ColorMode | undefined,
): Instance {
  if (mainMode === undefined || explicitMode(instance) !== undefined) return instance;
  return { ...instance, colorMode: mainMode };
}

/**
 * Whether two shown instances differ in the colour mode the scene reads.
 *
 * @param a - One instance as shown, if any.
 * @param b - The other.
 * @returns True when their explicit modes differ.
 */
export function isColorModeChanged(a: InstanceObject | undefined, b: InstanceObject): boolean {
  return explicitMode(a) !== explicitMode(b);
}
