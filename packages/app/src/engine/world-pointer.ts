import { screenToWorld, type Camera } from '@canvas/engine';
import type { SelectPointer } from '@canvas/tools';

import type { ScreenPointer, ScreenPointerInput } from './select-input-binding.js';

/** A screen pointer input that has a point: a press, a move, a release or a secondary click. */
type ScreenPointInput = Extract<ScreenPointerInput, ScreenPointer>;

/**
 * A screen pointer input on the board: its point and the samples coalesced into it (its
 * `trail`) mapped to world units through the camera (`screenToWorld`), each sample's
 * pressure kept. Pure.
 *
 * @param input - The input, CSS px on the canvas.
 * @param camera - The camera now.
 * @returns The input with its world point, and its trail in world units when it has one.
 */
export function worldPointerOf<Input extends ScreenPointInput>(
  input: Input,
  camera: Camera,
): Omit<Input, 'trail'> & Pick<SelectPointer, 'world' | 'trail'> {
  const { trail, ...rest } = input;
  const world = screenToWorld(camera, input.screen);
  if (trail === undefined) return { ...rest, world };
  return {
    ...rest,
    world,
    trail: trail.map(({ screen, pressure }) => ({
      world: screenToWorld(camera, screen),
      ...(pressure === undefined ? {} : { pressure }),
    })),
  };
}
