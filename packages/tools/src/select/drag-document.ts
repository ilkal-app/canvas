import type { BoardObject, ObjectId } from '@canvas/schema';

import { dropTargetBox, stackDropOf } from './drop-target.js';
import { MovedIds } from './moved-ids.js';
import type { OrientedBox } from './oriented-box.js';
import type { SelectHitTester } from './select-hit-tester.js';
import type { SelectionSource } from './selection-geometry.js';
import type { StackSlot } from './stack-reorder.js';
import type { TransformPlan } from './transform-plan.js';

/**
 * The document as a drag's drop rules read it: objects as they are now, each container's
 * children read once until `clear` (a stack slot no longer lists its container on every move), and
 * the moving ids as one set per membership. The gesture clears it when the document changes and
 * when the drag ends.
 */
export class DragDocument implements SelectionSource {
  private readonly children = new Map<ObjectId, readonly ObjectId[]>();
  private readonly moving = new MovedIds();

  /** The document's drawable gate, when it has one: drop rules skip what it does not draw. */
  readonly isDrawable?: (id: ObjectId) => boolean;

  /**
   * Wraps a document.
   *
   * @param document - The document.
   */
  constructor(private readonly document: SelectionSource) {
    if (document.isDrawable) this.isDrawable = (id) => document.isDrawable?.(id) ?? true;
  }

  /**
   * An object as the document has it now.
   *
   * @param id - The object.
   * @returns It, or undefined.
   */
  get(id: ObjectId): BoardObject | undefined {
    return this.document.get(id);
  }

  /**
   * An object's children, as the document listed them when first asked during this drag.
   *
   * @param id - The object.
   * @returns Its children.
   */
  childrenOf(id: ObjectId): readonly ObjectId[] {
    let children = this.children.get(id);
    if (children === undefined) {
      children = [...this.document.childrenOf(id)];
      this.children.set(id, children);
    }
    return children;
  }

  /**
   * Where a move would drop now, as the overlay shows it: the frame the primary object lands in
   * (`dropTargetBox`) and the auto-layout slot the boxes take (`stackDropOf`), read through this.
   *
   * @param plan - The move.
   * @param selection - The selection, for its primary object.
   * @param selection.primaryId - The primary object.
   * @param hitTester - Finds frames under a point.
   * @returns The frame's box and the slot, each when there is one.
   */
  dropsOf(
    plan: TransformPlan & { readonly kind: 'move' },
    selection: { readonly primaryId?: ObjectId | undefined },
    hitTester: SelectHitTester,
  ): { readonly target?: OrientedBox | undefined; readonly slot?: StackSlot | undefined } {
    const movedIds = this.moving.of(plan.ids);
    const { primaryId } = selection;
    return {
      target: dropTargetBox(plan, primaryId, this, hitTester, movedIds),
      slot: stackDropOf(plan, primaryId, this, hitTester, movedIds),
    };
  }

  /** Forgets every list: the document changed, or the drag ended. */
  clear(): void {
    this.children.clear();
  }
}
