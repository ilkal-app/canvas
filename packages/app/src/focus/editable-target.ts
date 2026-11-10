/** Elements where typing edits text, or where letters and arrows choose an option. */
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * Whether a key event's target is somewhere the person is typing, so that canvas shortcuts
 * must leave the key alone: text fields, text areas, selects and contenteditable regions
 * (including their descendants). Ported from the prototype's window key guard
 * (webgl-whiteboard `src/app/controller.ts`, `onWindowKeyDown`), which skipped INPUT, SELECT and
 * TEXTAREA targets; contenteditable is added for rich-text editing.
 *
 * @param target - The event's target, or the first entry of `composedPath()` inside shadow DOM.
 * @returns True when the target is, or is inside, an editable element.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}
