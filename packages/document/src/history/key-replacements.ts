import * as Y from 'yjs';

import type { UndoStep } from './field-guard.js';

/**
 * Tells whether an undo or redo step replaced the value of the key a map entry holds: the step
 * deleted one of the key's earlier values, which Yjs keeps to the entry's left in the key's item
 * chain (deleted values stay in the chain).
 *
 * @param entry - A map entry.
 * @param step - The step.
 * @returns `true` when the step deleted a value of the entry's key that came before it.
 */
export function isKeyReplacedBy(entry: Y.Item, step: UndoStep): boolean {
  for (let earlier = entry.left; earlier !== null; earlier = earlier.left) {
    if (Y.isDeleted(step.deletions, earlier.id)) return true;
  }
  return false;
}

/**
 * Earlier-key replacement decisions for one synchronous `SingleStep.apply` only. Yjs 13.6.33
 * restores all items before its delete-filter loop; deletion marks items without changing left
 * links, and cleanup merges/GC run afterwards. Never share this memo across apply calls: capture,
 * remote updates and redone copies can change the step or chains. Current-value and causal checks
 * remain live. Dropped in `SingleStep.apply`'s finally, including when the manager throws.
 */
export class KeyReplacements {
  readonly #results = new WeakMap<Y.Item, boolean>();

  /**
   * Starts an empty memo for the exact step handed to Yjs, including a substituted step.
   *
   * @param step - The step whose deletion set is fixed during its filter phase.
   */
  constructor(private readonly step: UndoStep) {}

  /**
   * Reads whether the step replaced this entry's key, sharing only repeated entry identities.
   *
   * @param entry - A map entry; a re-created entry has its own identity.
   * @param step - The current step; another step is evaluated without caching.
   * @returns Whether the step deleted an earlier value of the key.
   */
  has(entry: Y.Item, step: UndoStep): boolean {
    if (step !== this.step) return isKeyReplacedBy(entry, step);
    const isKnown = this.#results.get(entry);
    if (isKnown !== undefined) return isKnown;
    const isReplaced = isKeyReplacedBy(entry, step);
    this.#results.set(entry, isReplaced);
    return isReplaced;
  }
}
