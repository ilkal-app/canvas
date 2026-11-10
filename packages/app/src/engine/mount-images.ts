import { screenToWorld, type Camera } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import { NO_IMAGES_MESSAGE, type PageImages } from '../assets/page-images.js';
import type { PasteTarget } from '../clipboard/paste-handlers.js';

import { bindImageDrop, ImagePicker } from './image-input.js';

/**
 * The paste location with the page's images: its board and what a paste can do with images
 * (insert files, link images copied from another board). Without the page's images, as it is.
 *
 * @param target - The engine's paste location.
 * @param images - The page's images, or undefined.
 * @returns The location.
 */
export function withPageImages(target: PasteTarget, images: PageImages | undefined): PasteTarget {
  if (images === undefined) return target;
  const { boardId } = images;
  return {
    ...target,
    ...(boardId === undefined ? {} : { boardId }),
    images: {
      insert: (files, at) => {
        void images.insert(files, at, target);
      },
      wasCopiedFrom: (assetIds, board) => images.copies.wasCopiedFrom(assetIds, board),
      linkFrom: (assetIds, sourceBoard) => images.linkFrom(assetIds, sourceBoard),
    },
    // A pasted link's preview comes through the same assets service.
    unfurlLink: (url) => images.request((http) => http.unfurl(url)),
  };
}

/**
 * A mount's ways in for images: files dropped on the canvas, and the image tool's
 * picker, both placed through the page's images at the paste location (dropped at the drop's
 * point, picked at the given point or the view's centre). A page without images says so. Page.
 */
export class MountImages {
  private readonly picker: ImagePicker;
  private readonly pasteTarget: () => PasteTarget;
  private readonly unbind: () => void;

  /**
   * Starts taking drops on the canvas.
   *
   * @param canvas - The engine's canvas.
   * @param pasteTarget - The paste location now, with the page's images (`withPageImages`).
   * @param camera - The camera on screen now.
   * @param canEdit - Whether the person may edit now; a viewer's drops are refused.
   */
  constructor(
    canvas: HTMLCanvasElement,
    pasteTarget: () => PasteTarget,
    camera: () => Camera,
    canEdit: () => boolean = () => true,
  ) {
    this.picker = new ImagePicker(canvas.ownerDocument);
    this.pasteTarget = pasteTarget;
    this.unbind = bindImageDrop(
      canvas,
      (files, at) => {
        this.insert(files, screenToWorld(camera(), at));
      },
      canEdit,
    );
  }

  /**
   * Opens the picker; the images chosen go centred on the point, or the view's centre.
   *
   * @param at - The point, world units, or undefined.
   * @returns Settles once the picker closed and the images were placed.
   */
  async pick(at: Point | undefined): Promise<void> {
    if (this.pasteTarget().images === undefined) {
      this.pasteTarget().notify(NO_IMAGES_MESSAGE);
      return;
    }
    const files = await this.picker.pick();
    if (files.length > 0) this.insert(files, at ?? this.pasteTarget().viewCentre);
  }

  /** Stops taking drops and removes the picker. */
  destroy(): void {
    this.unbind();
    this.picker.destroy();
  }

  /**
   * Places image files through the page's images, or says the page has none.
   *
   * @param files - The files.
   * @param at - Where they go, world units.
   */
  private insert(files: readonly File[], at: Point): void {
    const target = this.pasteTarget();
    if (target.images === undefined) target.notify(NO_IMAGES_MESSAGE);
    else target.images.insert(files, at);
  }
}
