import { vi } from 'vitest';

/**
 * Two indexed reads drain each candidate: at(-1) and pop. A factor of two leaves room for
 * another linear bookkeeping pass, plus a terminal candidate; repeated full scans still fail.
 */
export const CANDIDATE_READS_PER_CLIENT = 4;

/**
 * The allowed candidate reads, shared by the observer and its assertions.
 *
 * @param clientCount - Number of candidate clients.
 * @returns A linear bound including one terminal candidate.
 */
export function candidateReadLimit(clientCount: number): number {
  return CANDIDATE_READS_PER_CLIENT * (clientCount + 1);
}

/**
 * Counts indexed reads while replay drains its sorted client list, including derived arrays.
 * Sorting and scanning are deliberately outside this property. The synchronous spy is always
 * restored; no production observer or timing-dependent assertion is needed.
 *
 * @param clientCount - The candidate list's size.
 * @param run - The synchronous replay to observe.
 * @returns Its result, indexed reads and number of candidate lists observed.
 */
export function countCandidateReads<T>(
  clientCount: number,
  run: () => T,
): { result: T; reads: number; lists: number } {
  let reads = 0;
  let lists = 0;
  const limit = candidateReadLimit(clientCount);
  const originalSort: (this: number[], compare?: (a: number, b: number) => number) => number[] =
    Array.prototype.sort;

  function observe(values: number[]): number[] {
    return new Proxy(values, {
      get(target, key, receiver): unknown {
        if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) {
          reads += 1;
          if (reads > limit) throw new Error('Client candidate reads exceeded the linear bound');
        }
        // Keep filter/slice outputs observed: the old replay otherwise escapes the counter
        // after the first filtering pass.
        if (key === 'constructor') return { [Symbol.species]: observedArray };
        return Reflect.get(target, key, receiver);
      },
    });
  }

  function observedArray(length: number): number[] {
    return observe(new Array<number>(length));
  }

  const spy = vi.spyOn(Array.prototype, 'sort').mockImplementation(function (
    this: number[],
    compare,
  ) {
    const sorted = originalSort.call(this, compare);
    if (sorted.length !== clientCount || !sorted.every((value) => typeof value === 'number')) {
      return sorted;
    }
    lists += 1;
    return observe(sorted);
  });
  try {
    const result = run();
    return { result, reads, lists };
  } finally {
    spy.mockRestore();
  }
}
