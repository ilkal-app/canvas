/** The `keyCode` browsers give every key an input method is processing. */
const IME_PROCESS_KEY_CODE = 229;

/**
 * Whether a key belongs to an input method's composition, so a field must not act on it: Enter
 * that commits a Japanese or Chinese word must not submit, Escape that cancels one must not
 * close. `isComposing` alone misses Safari's: the key that ends a composition arrives after
 * `compositionend`, with `isComposing` false but `keyCode` 229, so this checks both,
 * as the `isComposing` guidance does.
 *
 * @param event - The key event.
 * @param event.isComposing - Whether a composition is under way.
 * @param event.keyCode - The legacy key code; 229 while an input method processes the key.
 * @returns True for a key the input method has.
 */
export function isImeKey(event: {
  readonly isComposing: boolean;
  readonly keyCode?: number;
}): boolean {
  // `keyCode` is deprecated, but it is the only sign Safari gives.

  return event.isComposing || event.keyCode === IME_PROCESS_KEY_CODE;
}
