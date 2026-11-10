import { useRef } from 'react';

import { nextRovingIndex } from './roving-index.js';

// Typeahead for a menu or listbox (the WAI-ARIA menu and listbox patterns): letters
// typed in quick succession make a prefix, and the next item whose name starts with it becomes
// the active one. One letter searches from after the active item (typing it again cycles through
// the items it starts); a longer prefix searches from the active item itself, so it stays put
// while the prefix still names it.

/** A key press as typeahead reads it: the key and the modifiers held. */
type TypeaheadKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>;

/** How long a pause starts a new prefix, ms. */
export const TYPEAHEAD_RESET_MS = 500;

/**
 * Whether a key press is a letter or digit for typeahead: one printable character, no Control,
 * Alt or Meta held. Space is not one (it chooses an item), unless a prefix is under way.
 *
 * @param event - The key press.
 * @param hasPrefix - Whether a prefix is under way.
 * @returns Whether it types.
 */
export function isTypeaheadKey(event: TypeaheadKey, hasPrefix: boolean): boolean {
  if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return false;
  return event.key !== ' ' || hasPrefix;
}

/**
 * The item a prefix moves to: the first, in order and wrapping, whose name starts with the
 * prefix (ignoring case and surrounding space), searching from after `active` for one letter
 * and from `active` itself for more. Pure.
 *
 * @param names - The items' names, in order.
 * @param active - The item active now (-1 for none).
 * @param prefix - What was typed.
 * @returns The item's index, or undefined when none starts with it.
 */
export function typeaheadIndex(
  names: readonly string[],
  active: number,
  prefix: string,
): number | undefined {
  const wanted = prefix.toLocaleLowerCase();
  const start = prefix.length === 1 ? active + 1 : Math.max(active, 0);
  for (let step = 0; step < names.length; step += 1) {
    const index = (start + step) % names.length;
    if ((names[index] ?? '').trim().toLocaleLowerCase().startsWith(wanted)) return index;
  }
  return undefined;
}

/**
 * What a key press does to a menu's or listbox's typeahead: nothing (a key that does not type,
 * left to the menu's other keys), or it typed, moving to `next` if an item starts with the
 * prefix. A typed key is the menu's even when it names no item, so it never reaches the canvas's
 * shortcuts or a parent menu.
 */
export type TypeaheadResult = { readonly next: number | undefined } | undefined;

/**
 * What a prefix searches for: the prefix, or one letter when it is a letter repeated (typing L L
 * cycles through the items L starts, rather than looking for "ll").
 *
 * @param text - The letters typed so far.
 * @returns What to search for.
 */
function searchedFor(text: string): string {
  return /^(.)\1*$/su.exec(text)?.[1] ?? text;
}

/**
 * A menu's or listbox's typeahead: given a key press, its items' names and the active
 * item, whether it typed and the item it moves to ({@link TypeaheadResult}). Keeps the prefix
 * between presses, and starts a new one after {@link TYPEAHEAD_RESET_MS}.
 *
 * @returns The typeahead.
 */
export function useTypeahead(): (
  event: TypeaheadKey,
  names: readonly string[],
  active: number,
) => TypeaheadResult {
  const prefixRef = useRef({ text: '', at: 0 });
  return (event, names, active) => {
    const now = Date.now();
    const held = prefixRef.current;
    const prefix = now - held.at > TYPEAHEAD_RESET_MS ? '' : held.text;
    if (!isTypeaheadKey(event, prefix !== '')) return undefined;
    const text = prefix + event.key;
    prefixRef.current = { text, at: now };
    return { next: typeaheadIndex(names, active, searchedFor(text)) };
  };
}

/**
 * The name typeahead reads of a menu item: its label (`data-menu-label`), else its text.
 *
 * @param item - The item.
 * @returns Its name.
 */
function itemName(item: Element): string {
  return (item.querySelector('[data-menu-label]') ?? item).textContent;
}

/**
 * A menu's moves: what a key press does among `items`, by typeahead on their labels
 * first, then by the roving keys (`nextRovingIndex`: the arrows wrap, Home and End). Undefined
 * for a key that is not the menu's; `{ next }` for one that is, `next` the item to focus (none
 * when typed letters name no item).
 *
 * @returns The moves.
 */
export function useMenuMoves(): (
  event: TypeaheadKey,
  items: readonly Element[],
  focused: number,
) => TypeaheadResult {
  const typeahead = useTypeahead();
  return (event, items, focused) => {
    const typed = typeahead(event, items.map(itemName), focused);
    if (typed !== undefined) return typed;
    const next = nextRovingIndex(event.key, Math.max(0, focused), items.length);
    return next === undefined ? undefined : { next };
  };
}
