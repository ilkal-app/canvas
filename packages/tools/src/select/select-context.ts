import type { WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { outerGroupOf } from './entered-group.js';
import type { OrientedBox } from './oriented-box.js';
import type { SelectControllerOptions } from './select-controller-options.js';
import type { SelectToolContext } from './select-press.js';
import type { SelectionFrameCache } from './selection-frame-cache.js';
import type { SelectionSource } from './selection-geometry.js';
import type { SelectionState } from './selection-state.js';

/** Builds select-tool input context from the controller's stable document and frame sources. */
export class SelectContext {
  /**
   * Keeps the controller's sources without copying them.
   *
   * @param frame - Reads the controller frame, including its gesture preview.
   * @param cache - The cached document frame and control flags.
   * @param document - The document without the drag preview.
   * @param options - The controller options, including the current hit tester.
   */
  constructor(
    private readonly frame: () => OrientedBox | undefined,
    private readonly cache: SelectionFrameCache,
    private readonly document: SelectionSource,
    private readonly options: SelectControllerOptions,
  ) {}

  private generation = 0;

  /** Counts a change to the document, here or from a collaborator. */
  documentChanged(): void {
    this.generation += 1;
  }

  /**
   * The context the tool steps in, from the current gesture and cached frame and resize flags.
   *
   * @param selection - The selection now.
   * @param enteredGroupId - The innermost entered group, or null.
   * @param zoom - The camera zoom.
   * @param visible - The world the viewport shows.
   * @returns The context.
   */
  build(
    selection: SelectionState,
    enteredGroupId: ObjectId | null,
    zoom: number,
    visible?: WorldBounds,
  ): SelectToolContext {
    const [id] = selection.ids;
    return {
      zoom,
      visible,
      selection,
      frame: this.frame(),
      canResize: this.cache.canResize(),
      resizeAspect: this.cache.resizeAspect(),
      isLocked: this.cache.isLocked(),
      // A person who cannot edit gets no handles or rotation bands to press.
      hasFrameControls: this.options.canEdit?.() !== false && this.cache.hasFrameControls(),
      isSingleShape:
        selection.ids.length === 1 && id !== undefined && this.document.get(id)?.type === 'shape',
      hitTester: this.options.hitTester,
      documentGeneration: this.generation,
      outerGroupId: outerGroupOf(enteredGroupId, this.document),
    };
  }
}
