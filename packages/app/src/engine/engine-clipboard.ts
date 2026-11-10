import { screenToWorld, type Camera } from '@canvas/engine';
import type { Board, ObjectId } from '@canvas/schema';
import type { ScreenPoint } from '@canvas/tools';

import type { PageImages } from '../assets/page-images.js';
import { encodeClipboardFlavours } from '../clipboard/clipboard-flavours.js';
import type { ClipboardFlavours } from '../clipboard/clipboard-formats.js';
import type { PreparedCut } from '../clipboard/clipboard-source.js';
import { imageAssetsOf } from '../clipboard/linked-paste.js';
import type { PasteTarget } from '../clipboard/paste-handlers.js';
import type { CanvasAction } from '../state/shell-action.js';

import { bindComponentDrop } from './component-drop.js';
import type { DocumentClipboard } from './document-clipboard.js';
import { withPageImages } from './mount-images.js';

/**
 * A mount's clipboard side: the selection as
 * clipboard flavours, a prepared cut, the paste location at the pointer, duplicate (mod+d), and a
 * main's instance placed at the view's centre or where a components panel row is dropped.
 * It follows the pointer over the canvas
 * (any pointer, hovering or pressed; none once it leaves), since a paste lands at the pointer and
 * only while it is on the canvas. Main thread.
 */
export class EngineClipboard {
  private readonly document: DocumentClipboard;
  private readonly camera: () => Camera;
  private readonly images: PageImages | undefined;
  private readonly unbind: () => void;
  /** The pointer on the canvas, CSS px, or undefined while it is off the canvas. */
  private pointer: ScreenPoint | undefined;

  /**
   * Starts following the pointer over the canvas.
   *
   * @param canvas - The engine's canvas.
   * @param document - The document's clipboard side.
   * @param camera - The camera on screen now.
   * @param images - The page's images: the board a copy names, and a paste's images.
   */
  constructor(
    canvas: HTMLCanvasElement,
    document: DocumentClipboard,
    camera: () => Camera,
    images?: PageImages,
  ) {
    this.document = document;
    this.camera = camera;
    this.images = images;
    const follow = (event: PointerEvent): void => {
      const box = canvas.getBoundingClientRect();
      this.pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const leave = (): void => {
      this.pointer = undefined;
    };
    canvas.addEventListener('pointermove', follow);
    canvas.addEventListener('pointerdown', follow);
    canvas.addEventListener('pointerleave', leave);
    // A components panel row dropped on the canvas places an instance there.
    const unbindDrop = bindComponentDrop(
      canvas,
      (mainId, at) => {
        document.placeInstance(mainId as ObjectId, screenToWorld(camera(), at));
      },
      () => document.canPlace(),
    );
    this.unbind = () => {
      unbindDrop();
      canvas.removeEventListener('pointermove', follow);
      canvas.removeEventListener('pointerdown', follow);
      canvas.removeEventListener('pointerleave', leave);
    };
  }

  /**
   * The selection as clipboard flavours: the objects, their texts, and styled HTML.
   *
   * @returns The flavours, or `undefined` when nothing selected can be copied.
   */
  copySelection(): ClipboardFlavours | undefined {
    const copied = this.document.copySelection();
    if (copied === undefined) return undefined;
    this.remember(copied);
    return encodeClipboardFlavours(copied, this.images?.boardId, this.document.clipboardColors());
  }

  /**
   * Prepares a cut of the selection: its flavours and the delete to run once they are written.
   *
   * @returns The prepared cut.
   */
  prepareCut(): PreparedCut {
    const cut = this.document.prepareCut();
    if (cut.kind !== 'ready') return cut;
    this.remember(cut.copied);
    return {
      kind: 'ready',
      flavours: encodeClipboardFlavours(
        cut.copied,
        this.images?.boardId,
        this.document.clipboardColors(),
      ),
      remove: () => {
        cut.remove();
      },
    };
  }

  /**
   * Records the boards' images a copy puts on the clipboard, with the board they come from, so
   * a later paste (in any tab of this browser) trusts that source and no other.
   *
   * @param copied - The copy.
   */
  private remember(copied: Board): void {
    const boardId = this.images?.boardId;
    if (boardId !== undefined) this.images?.copies.record(imageAssetsOf(copied), boardId);
  }

  /**
   * Where a paste goes now: the pointer and the view's centre on the board, at the camera on
   * screen, with the page's images (its board, and what a paste can do with images).
   *
   * @returns The target.
   */
  pasteTarget(): PasteTarget {
    const camera = this.camera();
    const centre = { x: camera.viewportWidthPx / 2, y: camera.viewportHeightPx / 2 };
    const pointer = this.pointer === undefined ? undefined : screenToWorld(camera, this.pointer);
    const target = this.document.pasteTarget(pointer, screenToWorld(camera, centre));
    return withPageImages(target, this.images);
  }

  /**
   * Acts on the canvas actions the clipboard side owns: duplicate (mod+d), and placing a main's
   * instance at a point or the view's centre (where a paste would land). Copy, cut and
   * paste arrive through the shell's clipboard router instead.
   *
   * @param action - The canvas action.
   * @returns Whether it was handled here.
   */
  runCanvasAction(action: CanvasAction): boolean {
    if (action.type === 'component' && action.command === 'placeInstanceAt') {
      this.document.placeInstance(action.id, action.at ?? this.pasteTarget().viewCentre);
      return true;
    }
    if (action.type !== 'selection' || action.command !== 'duplicate') return false;
    this.document.duplicateSelection();
    return true;
  }

  /** Stops following the pointer. */
  destroy(): void {
    this.unbind();
  }
}
