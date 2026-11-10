import type { BoardObject, ObjectId } from '@canvas/schema';

import { isPaintOnlyPresetEdit, presetEdits } from './main-reads.js';

/** A referenced main as an instance last read it. */
export interface MainRead {
  readonly main: BoardObject | undefined;
  readonly key: string;
}

/**
 * The preset edits one `InstanceExpansion.dependentsOf` step found: which
 * mains' presets alone changed, as they read now, for the instances that patch rather than
 * re-resolve; and whether any of those edits goes beyond paint, so no copy may keep its place.
 */
export class PresetStep {
  /** Mains whose presets alone changed for some instance, as they read now. */
  readonly reads = new Map<ObjectId, MainRead>();
  /** Some preset edit may move, hide or size a copy: anything beyond `isPaintOnlyPresetEdit`. */
  isLayoutChanged = false;
  /**
   * The preset edits between each snapshot an instance read and the main now. Each instance
   * diffs against its own snapshot: one resolved earlier in the step has read the new main
   * already, and the rest have not. Most share one snapshot, so a thousand diff once.
   */
  private readonly diffs = new Map<BoardObject | undefined, Set<ObjectId> | undefined>();

  /** Forgets the snapshot diffs, as each changed id diffs against its own main. */
  clear(): void {
    this.diffs.clear();
  }

  /**
   * The children a main's presets alone changed since an instance read it (`presetEdits`),
   * recording the main as it reads now when they did.
   *
   * @param id - The main.
   * @param snapshot - The main as the instance read it.
   * @param now - The main now.
   * @param keyOf - Its main key now, computed once.
   * @returns The changed children, or undefined when the instance must resolve in full.
   */
  childrenEdited(
    id: ObjectId,
    snapshot: BoardObject | undefined,
    now: BoardObject | undefined,
    keyOf: () => string,
  ): Set<ObjectId> | undefined {
    if (this.diffs.has(snapshot)) return this.diffs.get(snapshot);
    const children = presetEdits(snapshot, now);
    this.diffs.set(snapshot, children);
    if (children !== undefined) {
      this.reads.set(id, { main: now, key: keyOf() });
      if (!isPaintOnlyPresetEdit(snapshot, now)) this.isLayoutChanged = true;
    }
    return children;
  }
}
