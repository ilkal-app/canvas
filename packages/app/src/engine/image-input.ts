import type { ScreenPoint } from '@canvas/tools';

import { ACCEPTED_IMAGE_TYPES } from '../assets/image-files.js';

/**
 * The page's file picker for images (the image tool, `i`): one hidden `<input type="file">`
 * taking several images of the accepted types, opened on the person's gesture (a browser opens a
 * picker only then). A pick settles with the files chosen, or none when the picker was cancelled
 * (`cancel`) or a newer pick replaced it. Page.
 */
export class ImagePicker {
  private readonly document: Document;
  private input: HTMLInputElement | undefined;
  private settle: ((files: File[]) => void) | undefined;

  /**
   * Picks nothing yet.
   *
   * @param document - The page's document, where the input goes.
   */
  constructor(document: Document) {
    this.document = document;
  }

  /**
   * Opens the picker.
   *
   * @returns The files chosen; none when cancelled or replaced.
   */
  pick(): Promise<File[]> {
    this.settle?.([]);
    const input = this.ensureInput();
    input.value = '';
    return new Promise((resolve) => {
      this.settle = resolve;
      input.click();
    });
  }

  /** Removes the input; a pick waiting settles with nothing. */
  destroy(): void {
    this.settle?.([]);
    this.settle = undefined;
    this.input?.remove();
    this.input = undefined;
  }

  /**
   * The input, made on first use.
   *
   * @returns The input.
   */
  private ensureInput(): HTMLInputElement {
    if (this.input !== undefined) return this.input;
    const input = this.document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_IMAGE_TYPES.join(',');
    input.multiple = true;
    input.hidden = true;
    input.dataset.imagePicker = '';
    const finish = (files: File[]) => {
      const settle = this.settle;
      this.settle = undefined;
      settle?.(files);
    };
    input.addEventListener('change', () => {
      finish([...(input.files ?? [])]);
    });
    input.addEventListener('cancel', () => {
      finish([]);
    });
    this.document.body.append(input);
    this.input = input;
    return input;
  }
}

/**
 * Lets image files be dropped on the canvas (drag-drop): a drag carrying files is accepted as a
 * copy, and a drop of files hands them over with the drop's point on the canvas. Drags of anything
 * else are left to the page. While `canDrop` says no (a person who cannot edit), a drag of
 * files is refused (`dropEffect` none) and a drop hands nothing over; the page still never opens
 * the files itself. Page.
 *
 * @param canvas - The engine's canvas.
 * @param onDrop - Receives the files and where they were dropped, CSS px on the canvas.
 * @param canDrop - Whether files may be dropped now; always when absent.
 * @returns Removes the listeners.
 */
export function bindImageDrop(
  canvas: HTMLCanvasElement,
  onDrop: (files: File[], at: ScreenPoint) => void,
  canDrop: () => boolean = () => true,
): () => void {
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
  const over = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = canDrop() ? 'copy' : 'none';
  };
  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (!canDrop()) return;
    const box = canvas.getBoundingClientRect();
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0)
      onDrop(files, { x: event.clientX - box.left, y: event.clientY - box.top });
  };
  canvas.addEventListener('dragover', over);
  canvas.addEventListener('drop', drop);
  return () => {
    canvas.removeEventListener('dragover', over);
    canvas.removeEventListener('drop', drop);
  };
}
