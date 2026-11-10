import { describe, expect, it } from 'vitest';

import { emptyTally, runStampFuzz, type FuzzTally } from './__fixtures__/stamp-fuzz-run.js';

// The relay's stamp check against the store's own guard (fix round 2), over many
// seeded runs of honest tabs and hostile writers: every update the check accepts is applied to
// the relay's copy of the board, and the real `DocumentVersionGuard` must then open it, there
// and on a replica loading what the relay stores; honest
// updates are never refused for good, and held back only when Yjs itself would keep part of
// them pending. A failure names its seed and step; replay one seed with
// `STAMP_FUZZ_SEED=<seed> pnpm vitest run --project @canvas/document update-stamp-check.differential`,
// and run more with `STAMP_FUZZ_RUNS` and `STAMP_FUZZ_STEPS`.

/** The first seed of the default runs, fixed so CI is repeatable. */
const FIRST_SEED = 20_260_927;

/**
 * Reads a positive whole number from the environment.
 *
 * @param name - The variable.
 * @param fallback - Its value when unset.
 * @returns The number.
 */
function fromEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * The seeds to run: one to replay, or a range from {@link FIRST_SEED}.
 *
 * @param runs - How many seeds by default.
 * @returns The seeds.
 */
function seeds(runs: number): number[] {
  const replay = process.env.STAMP_FUZZ_SEED;
  if (replay !== undefined) return [Number(replay)];
  const count = fromEnvironment('STAMP_FUZZ_RUNS', runs);
  return Array.from({ length: count }, (unused, index) => FIRST_SEED + index);
}

/**
 * Runs every seed and adds up the verdicts.
 *
 * @param runs - How many seeds by default.
 * @param isHostile - Whether hostile writers take part.
 * @returns The failures and the summed verdicts.
 */
async function fuzz(
  runs: number,
  isHostile: boolean,
): Promise<{ failures: string[]; tally: FuzzTally }> {
  const steps = fromEnvironment('STAMP_FUZZ_STEPS', 60);
  const failures: string[] = [];
  const tally = emptyTally();
  for (const seed of seeds(runs)) {
    // Let the test runner's worker answer its host between seeds on long runs.
    await new Promise((resolve) => setImmediate(resolve));
    const outcome = runStampFuzz(seed, steps, isHostile);
    if (outcome.failure !== undefined) failures.push(outcome.failure);
    for (const source of ['honest', 'hostile'] as const) {
      for (const [kind, count] of Object.entries(outcome.tally[source])) {
        tally[source][kind as keyof FuzzTally['honest']] += count;
      }
    }
  }
  if (process.env.STAMP_FUZZ_REPORT !== undefined) {
    process.stdout.write(`stamp fuzz verdicts: ${JSON.stringify(tally)}\n`);
    process.stdout.write(`stamp fuzz failures: ${JSON.stringify(failures)}\n`);
  }
  return { failures, tally };
}

/** A generous time limit for the runs asked for: 20 ms a step, at least two minutes. */
const TIME_LIMIT_MS = Math.max(
  120_000,
  20 * fromEnvironment('STAMP_FUZZ_RUNS', 40) * fromEnvironment('STAMP_FUZZ_STEPS', 60),
);

describe('UpdateStampCheck against the store’s guard, seeded', () => {
  it(
    'never accepts an update that leaves a board the guard refuses, and never refuses honesty',
    async () => {
      const { failures, tally } = await fuzz(40, true);
      expect(failures).toEqual([]);
      // The hostile writers did get updates through, and were refused: the run exercised both.
      expect(tally.hostile.accepted).toBeGreaterThan(0);
      expect(tally.hostile.unstamped).toBeGreaterThan(0);
    },
    TIME_LIMIT_MS,
  );

  it(
    'accepts honest tabs’ edits, reconnects, offline replays, undo and redo',
    async () => {
      const { failures, tally } = await fuzz(40, false);
      expect(failures).toEqual([]);
      expect(tally.honest.unstamped + tally.honest['invalid-stamp']).toBe(0);
      expect(tally.honest.accepted).toBeGreaterThan(0);
    },
    TIME_LIMIT_MS,
  );
});
