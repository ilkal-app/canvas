import {
  layerOpacityOf,
  type BoardObject,
  type ColorMode,
  type InstanceObject,
} from '@canvas/schema';

import { isColorModeChanged, mainColorModeOf, withMainColorMode } from './instance-color-mode.js';

// An instance's layer opacity as the scene shows it, as `instance-color-mode.ts` does
// for its colour mode: a main's own opacity fades its content and every instance that sets none
// of its own, and an instance's own opacity beats its main's. The scene multiplies an instance's
// virtual content by walking up to the instance (`SceneOpacity`), and the main is often on
// another page, so the expansion, which reads the main when it resolves an instance, hands its
// opacity down on the shown instance. A main's opacity change re-resolves its instances
// (`mainKey`).

/**
 * The opacity a main hands to its instances that set none.
 *
 * @param main - The referenced object, if the board has it.
 * @returns A component's own opacity below 1, or undefined when it is opaque or absent.
 */
export function mainOpacityOf(main: BoardObject | undefined): number | undefined {
  if (main?.type !== 'component') return undefined;
  const opacity = layerOpacityOf(main.opacity);
  return opacity < 1 ? opacity : undefined;
}

/**
 * An instance as the scene shows it: itself when it sets an `opacity` or its main is opaque;
 * otherwise a copy carrying its main's opacity. Pure.
 *
 * @param instance - The instance, stored or virtual (a nested instance's copy).
 * @param mainOpacity - Its main's opacity ({@link mainOpacityOf}).
 * @returns The instance to show.
 */
export function withMainOpacity<Instance extends BoardObject>(
  instance: Instance,
  mainOpacity: number | undefined,
): Instance {
  if (mainOpacity === undefined || ('opacity' in instance && instance.opacity !== undefined)) {
    return instance;
  }
  return { ...instance, opacity: mainOpacity };
}

/** What a main hands down to its instances that set none. */
export interface MainLayer {
  /** Its own colour mode (`mainColorModeOf`). */
  readonly mode: ColorMode | undefined;
  /** Its own opacity below 1 ({@link mainOpacityOf}). */
  readonly opacity: number | undefined;
}

/**
 * What a main hands down to its instances: its colour mode and its opacity.
 *
 * @param main - The referenced object, if the board has it.
 * @returns Its mode and opacity, each undefined when it hands none down.
 */
export function mainLayerOf(main: BoardObject | undefined): MainLayer {
  return { mode: mainColorModeOf(main), opacity: mainOpacityOf(main) };
}

/**
 * An instance as the scene shows it: with its main's colour mode and opacity where it sets none
 * (`withMainColorMode`, {@link withMainOpacity}). Pure.
 *
 * @param instance - The instance, stored or virtual.
 * @param layer - What its main hands down ({@link mainLayerOf}).
 * @returns The instance to show.
 */
export function withMainLayer<Instance extends BoardObject>(
  instance: Instance,
  layer: MainLayer,
): Instance {
  return withMainOpacity(withMainColorMode(instance, layer.mode), layer.opacity);
}

/**
 * Whether two shown instances differ in what the scene reads of their main: the colour mode or
 * the opacity.
 *
 * @param a - One instance as shown, if any.
 * @param b - The other.
 * @returns True when their explicit modes or opacities differ.
 */
export function isShownLayerChanged(a: InstanceObject | undefined, b: InstanceObject): boolean {
  return isColorModeChanged(a, b) || a?.opacity !== b.opacity;
}
