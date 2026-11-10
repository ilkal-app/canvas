import { appendToActionLog } from '../harness/action-log.js';

import type { ChangeSetSummary } from './document-scene-feed.js';

/**
 * The document's change sets as the test harness reads them: the last hundred, and how many there
 * have been, since a stepped command makes many and a reader counts new ones by the total.
 */
export class ChangeLog {
  #recent: readonly ChangeSetSummary[] = [];
  #total = 0;

  /**
   * The recent change sets.
   *
   * @returns The last hundred, oldest first.
   */
  get recent(): readonly ChangeSetSummary[] {
    return this.#recent;
  }

  /**
   * How many change sets there have been.
   *
   * @returns The count.
   */
  get total(): number {
    return this.#total;
  }

  /**
   * Adds a change set.
   *
   * @param summary - Its summary.
   */
  add(summary: ChangeSetSummary): void {
    this.#recent = appendToActionLog(this.#recent, summary);
    this.#total += 1;
  }
}
