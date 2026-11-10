import { useSyncExternalStore } from 'react';

import type { ArrangeCommand } from '../state/shell-commands.js';

/** The popover's three arrange menus (round 2). */
export type ArrangeMenuId = 'alignHorizontal' | 'alignVertical' | 'distribute';

/** The last command each menu ran, which its button shows. */
export type ArrangeLastUsed = Readonly<Record<ArrangeMenuId, ArrangeCommand>>;

/** Where the last commands are kept, per viewer and device: a convenience, never shared. */
export const ARRANGE_LAST_USED_STORAGE_KEY = 'canvas.arrange-last-used';

/** Before anything ran: align left, align top, distribute horizontally. */
export const DEFAULT_ARRANGE_LAST_USED: ArrangeLastUsed = Object.freeze({
  alignHorizontal: 'alignLeft',
  alignVertical: 'alignTop',
  distribute: 'distributeHorizontally',
});

/** The commands each menu holds, so a stored value outside them is ignored. */
const MENU_COMMANDS: Readonly<Record<ArrangeMenuId, readonly ArrangeCommand[]>> = {
  alignHorizontal: ['alignLeft', 'alignCentre', 'alignRight'],
  alignVertical: ['alignTop', 'alignMiddle', 'alignBottom'],
  distribute: ['distributeHorizontally', 'distributeVertically'],
};

/**
 * The stored last commands, each kept only when it belongs to its menu; wrapped against storage
 * that throws or holds something else.
 *
 * @returns The last commands.
 */
function load(): ArrangeLastUsed {
  try {
    const value: unknown = JSON.parse(
      globalThis.localStorage.getItem(ARRANGE_LAST_USED_STORAGE_KEY) ?? 'null',
    );
    if (typeof value !== 'object' || value === null) return DEFAULT_ARRANGE_LAST_USED;
    const stored = value as Partial<Record<ArrangeMenuId, unknown>>;
    const pick = (menu: ArrangeMenuId): ArrangeCommand => {
      const command = stored[menu];
      return (
        MENU_COMMANDS[menu].find((known) => known === command) ?? DEFAULT_ARRANGE_LAST_USED[menu]
      );
    };
    return {
      alignHorizontal: pick('alignHorizontal'),
      alignVertical: pick('alignVertical'),
      distribute: pick('distribute'),
    };
  } catch {
    return DEFAULT_ARRANGE_LAST_USED;
  }
}

let current: ArrangeLastUsed | undefined;
const listeners = new Set<() => void>();

/**
 * The last commands now, read from storage once.
 *
 * @returns The last commands.
 */
function snapshot(): ArrangeLastUsed {
  current ??= load();
  return current;
}

/**
 * Notes the command a menu just ran, so its button shows it (round 2), and keeps it.
 *
 * @param menu - The menu.
 * @param command - The command it ran.
 */
export function noteArrangeUsed(menu: ArrangeMenuId, command: ArrangeCommand): void {
  const before = snapshot();
  const next = before[menu] === command ? before : { ...before, [menu]: command };
  try {
    globalThis.localStorage.setItem(ARRANGE_LAST_USED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A convenience: without storage, the buttons remember for this page only.
  }
  if (next === before) return;
  current = next;
  for (const listener of listeners) listener();
}

/**
 * Forgets what was read, for tests that change storage.
 */
export function resetArrangeLastUsed(): void {
  current = undefined;
}

/**
 * The last command each arrange menu ran, following {@link noteArrangeUsed}.
 *
 * @returns The last commands.
 */
export function useArrangeLastUsed(): ArrangeLastUsed {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot,
    snapshot,
  );
}
