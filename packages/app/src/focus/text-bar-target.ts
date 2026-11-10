/** The attribute that marks the floating text bar, whose controls keep the keyboard. */
export const TEXT_BAR_ATTRIBUTE = 'data-text-bar';

/**
 * Whether focus is in the floating text bar: the text editor's input then leaves the
 * keyboard there, as it does for a panel field, until the bar gives it back (Escape, a choice
 * made with the pointer).
 *
 * @param target - The focused element, or an event's target.
 * @returns True when it is, or is inside, the text bar.
 */
export function isInTextBar(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${TEXT_BAR_ATTRIBUTE}]`) !== null;
}

/**
 * Gives the keyboard back to the text editor's input (the hidden textarea marked
 * `data-text-input`), as Escape in the text bar does.
 *
 * @param from - An element of the page, whose document holds the input.
 * @returns Whether an input was there to take it.
 */
export function focusTextEditor(from: Element): boolean {
  const input = from.ownerDocument.querySelector<HTMLTextAreaElement>('textarea[data-text-input]');
  input?.focus({ preventScroll: true });
  return input !== null;
}
