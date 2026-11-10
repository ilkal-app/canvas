import { expect } from 'vitest';

import { BOARD_BOUND } from '@canvas/schema';

import type { CommandError } from '../command-error.js';
import type { AnyCommand } from '../command.js';

import { expectRejected } from './command-fixtures.js';

/** The board bound, short for the tests of. */
export const B = BOARD_BOUND;

/** One world unit past the bound. */
export const BEYOND = B + 1;

/**
 * Runs a command that must be refused as invalid input, leaving the document as it was: the
 * encoded state is byte-identical and no change set or update is delivered.
 *
 * @param store - The store.
 * @param command - The command.
 * @param input - Its input.
 * @returns The errors, all of code `invalid-input`.
 */
export function expectInvalidInput(
  store: Parameters<typeof expectRejected>[0],
  command: AnyCommand,
  input: unknown,
): readonly CommandError[] {
  const errors = expectRejected(store, command as never, input);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.map(({ code }) => code)).toEqual(errors.map(() => 'invalid-input'));
  return errors;
}

/**
 * Runs a command that must be refused because it would store a size a renderer cannot draw,
 * past 2^32, which the relay's door refuses (item 1): `invalid-object` naming the field,
 * before the board's bound is judged. Nothing is written.
 *
 * @param store - The store.
 * @param command - The command.
 * @param input - Its input.
 * @returns The errors, all of code `invalid-object` on `width` or `height`.
 */
export function expectPastDrawable(
  store: Parameters<typeof expectRejected>[0],
  command: AnyCommand,
  input: unknown,
): readonly CommandError[] {
  const errors = expectRejected(store, command as never, input);
  expect(errors.length).toBeGreaterThan(0);
  for (const { code, path, message } of errors) {
    expect(code).toBe('invalid-object');
    expect(['width', 'height']).toContain(path.at(-1));
    expect(message).toContain('past-extent');
  }
  return errors;
}

/**
 * A frame as `createObject` takes it, at a position.
 *
 * @param x - Its `x`.
 * @param y - Its `y`.
 * @returns The new object's fields.
 */
export const frameAt = (x: number, y: number) => ({
  type: 'frame' as const,
  x,
  y,
  width: 10,
  height: 10,
  name: 'F',
  clip: false,
  background: null,
});
