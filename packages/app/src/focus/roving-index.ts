/**
 * The next item to focus in a menu or list for a navigation key, wrapping at the ends: Arrow
 * Down and Arrow Up step, Home and End jump (WAI-ARIA roving focus). Pure.
 *
 * @param key - The key pressed (`KeyboardEvent.key`).
 * @param index - The item focused now.
 * @param count - How many items there are; at least one.
 * @returns The index, or undefined when the key does not navigate.
 */
export function nextRovingIndex(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
