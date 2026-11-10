import type { ScreenPoint } from '@canvas/tools';

/**
 * The drag data type of a components panel row (ruling 3), whose data is the main's id.
 * Its presence among a drag's types is enough to accept it; the id is read on the drop.
 */
export const COMPONENT_DRAG_TYPE = 'application/x-canvas-component';

/**
 * Lets a components panel row be dropped on the canvas (ruling 3): a drag carrying a
 * main is accepted as a copy, and its drop hands over the main's id and the drop's point on the
 * canvas. Drags of anything else are left to the page (image files: `bindImageDrop`). While
 * `canDrop` says no (a person who cannot edit) the drag is refused (`dropEffect` none)
 * and the drop hands nothing over. Page.
 *
 * @param canvas - The engine's canvas.
 * @param onDrop - Receives the main's id and where it was dropped, CSS px on the canvas.
 * @param canDrop - Whether a main may be dropped now; always when absent.
 * @returns Removes the listeners.
 */
export function bindComponentDrop(
  canvas: HTMLCanvasElement,
  onDrop: (mainId: string, at: ScreenPoint) => void,
  canDrop: () => boolean = () => true,
): () => void {
  const isMain = (event: DragEvent) =>
    event.dataTransfer?.types.includes(COMPONENT_DRAG_TYPE) === true;
  const over = (event: DragEvent) => {
    if (!isMain(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = canDrop() ? 'copy' : 'none';
  };
  const drop = (event: DragEvent) => {
    if (!isMain(event)) return;
    event.preventDefault();
    const mainId = event.dataTransfer?.getData(COMPONENT_DRAG_TYPE) ?? '';
    if (!canDrop() || mainId === '') return;
    const box = canvas.getBoundingClientRect();
    onDrop(mainId, { x: event.clientX - box.left, y: event.clientY - box.top });
  };
  canvas.addEventListener('dragover', over);
  canvas.addEventListener('drop', drop);
  return () => {
    canvas.removeEventListener('dragover', over);
    canvas.removeEventListener('drop', drop);
  };
}
