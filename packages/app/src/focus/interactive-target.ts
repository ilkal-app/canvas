/**
 * Elements that press, follow, open or toggle when Enter or Space reaches them: native controls,
 * editable regions and the ARIA roles whose widgets act on those keys.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  'input',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="link"]',
  '[role="combobox"]',
  '[role="switch"]',
  '[role="treeitem"]',
].join(', ');

/** `KeyboardEvent.key` values that activate a focused control (`Spacebar` is the old IE name). */
const CONTROL_ACTIVATION_KEYS: ReadonlySet<string> = new Set(['Enter', ' ', 'Spacebar']);

/**
 * Whether a key press is one a focused control acts on itself: Enter or Space.
 *
 * @param key - The event's `KeyboardEvent.key`.
 * @returns True for Enter and Space.
 */
export function isControlActivationKey(key: string): boolean {
  return CONTROL_ACTIVATION_KEYS.has(key);
}

/**
 * Whether a key event's target is, or is inside, a control that Enter or Space activates (a
 * button, a link, a disclosure summary, a form field, an editable region, or an element with a
 * button, menu item, option, tab, checkbox, radio, link, combobox, switch or tree item role). Canvas shortcuts bound to
 * those keys leave the key to such a control, so Enter on a focused toolbar button presses the
 * button instead of acting on the canvas selection.
 *
 * @param target - The event's target, or the first entry of `composedPath()` inside shadow DOM.
 * @returns True when the target is, or is inside, an interactive element.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}
