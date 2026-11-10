/**
 * The index of the row a key event in the layers list came from: the row element the
 * event started in, as the last render numbered it (`data-index`), else the focus target. A row
 * keeps focus while the rows change around it (a move by Alt with an arrow), and the focus target
 * follows it only in an effect and a render after the rows show the move; a key pressed in
 * between read the row the target still named, and moved another row, or none.
 *
 * @param target - The event's target.
 * @param focusTarget - The focus target's index, for a key on the list itself.
 * @returns The row's index.
 */
export function keyRowIndex(target: EventTarget | null, focusTarget: number): number {
  const row = target instanceof Element ? target.closest('[data-index]') : null;
  const index = Number(row?.getAttribute('data-index'));
  return row !== null && Number.isInteger(index) && index >= 0 ? index : focusTarget;
}
