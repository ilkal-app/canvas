import { useSyncExternalStore } from 'react';

import type { SelectionContext } from './panel-sections.js';

/**
 * The person's collapse choices for the inspector's sections ("remembered per kind for
 * the session"): for each context (the kind of selection) and section, whether they collapsed it
 * (true) or expanded it (false). Kept in memory only, so a reload starts again from each
 * section's default; never in the board or the browser's storage.
 */
export class SectionCollapseStore {
  private readonly choices = new Map<string, boolean>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  /**
   * The person's choice for a section in a context.
   *
   * @param context - The kind of selection.
   * @param sectionId - The section.
   * @returns True when they collapsed it, false when they expanded it, undefined before either.
   */
  choiceFor(context: SelectionContext, sectionId: string): boolean | undefined {
    return this.choices.get(keyOf(context, sectionId));
  }

  /**
   * Records the person's choice for a section in a context, telling every subscriber.
   *
   * @param context - The kind of selection.
   * @param sectionId - The section.
   * @param isCollapsed - Whether they collapsed it.
   */
  choose(context: SelectionContext, sectionId: string, isCollapsed: boolean): void {
    this.choices.set(keyOf(context, sectionId), isCollapsed);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /**
   * Calls a listener after every choice.
   *
   * @param listener - The listener.
   * @returns Stops calling it.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * A number that changes with every choice, for `useSyncExternalStore`.
   *
   * @returns The version.
   */
  snapshot(): number {
    return this.version;
  }
}

/**
 * The key of a section in a context.
 *
 * @param context - The kind of selection.
 * @param sectionId - The section.
 * @returns The key.
 */
function keyOf(context: SelectionContext, sectionId: string): string {
  return `${context}/${sectionId}`;
}

/** The page's one store: the session's choices, shared by every mount of the panel. */
export const SESSION_SECTION_COLLAPSE = new SectionCollapseStore();

/**
 * Whether a section shows collapsed: the person's choice for the context if they made one, else
 * the section's default. Pure.
 *
 * @param isChosenCollapsed - The person's choice ({@link SectionCollapseStore.choiceFor}).
 * @param isCollapsedByDefault - The section's default for what the panel shows.
 * @returns Whether it is collapsed.
 */
export function isSectionCollapsed(
  isChosenCollapsed: boolean | undefined,
  isCollapsedByDefault: boolean,
): boolean {
  return isChosenCollapsed ?? isCollapsedByDefault;
}

/**
 * Re-renders the caller whenever a choice is recorded in the store.
 *
 * @param store - The store.
 */
export function useSectionCollapse(store: SectionCollapseStore): void {
  useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.snapshot(),
  );
}
