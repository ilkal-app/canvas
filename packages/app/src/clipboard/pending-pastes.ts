// The pastes still being read in stages: a large paste reads its objects before its
// run holds the board, so whoever waits for the board to be idle (the benchmark's freeze window,
// through the engine harness) waits for those first.

/** How many staged pastes are being read now, in this page. */
let pending = 0;
/** Who waits for none to be. */
let waiters: (() => void)[] = [];

/**
 * Counts a staged paste as pending until its work settles, whatever it settles with.
 *
 * @param work - The paste's reading and creating.
 * @returns The same work.
 */
export function trackPaste<Result>(work: Promise<Result>): Promise<Result> {
  pending += 1;
  const settle = (): void => {
    pending -= 1;
    if (pending > 0) return;
    const settled = waiters;
    waiters = [];
    for (const resolve of settled) resolve();
  };
  work.then(settle, settle);
  return work;
}

/**
 * Resolves once no staged paste is being read: at once when none is.
 *
 * @returns The promise.
 */
export function whenPastesRead(): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}
