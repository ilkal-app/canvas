/**
 * What the shell says when an order command moved only part of the selection: the order
 * commands take the children of one parent, so a selection spanning several parents is reordered on
 * its largest same-parent subset and the rest stay.
 *
 * @param count - How many selected objects were left where they were, at least 1.
 * @returns The notice's text.
 */
export function leftOutNotice(count: number): string {
  return count === 1
    ? '1 object was left where it was: only objects in the same frame or group move together.'
    : `${String(count)} objects were left where they were: only objects in the same frame or group move together.`;
}
