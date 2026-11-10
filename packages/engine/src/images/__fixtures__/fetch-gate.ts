// A fetch gate for the texture manager's tests: holds back the fetches a test names, by kind and
// long edge (`level 2048`, `tile 0`, `original undefined`), until the test opens them, and
// records every fetch.
import type { FixtureFetch } from '../fixture-asset-source.js';

/** A fetch gate that holds back the fetches a test names until it opens them. */
export class FetchGate {
  /** Every fetch that reached the gate, as `kind longEdgePx`. */
  readonly seen: string[] = [];
  private readonly held = new Map<string, (() => void)[]>();
  private readonly blocked: Set<string>;

  /**
   * Creates a gate.
   *
   * @param blocked - The fetches to hold, as `kind longEdgePx`.
   */
  constructor(blocked: readonly string[] = []) {
    this.blocked = new Set(blocked);
  }

  readonly beforeFetch = (request: FixtureFetch): Promise<void> => {
    const name = `${request.kind} ${String(request.longEdgePx)}`;
    this.seen.push(name);
    if (!this.blocked.has(name)) return Promise.resolve();
    return new Promise((resolve) => {
      this.held.set(name, [...(this.held.get(name) ?? []), resolve]);
    });
  };

  /**
   * Lets the named fetches through, those held and those to come.
   *
   * @param name - The fetch, as `kind longEdgePx`.
   */
  open(name: string): void {
    this.blocked.delete(name);
    for (const resolve of this.held.get(name) ?? []) resolve();
    this.held.delete(name);
  }
}
