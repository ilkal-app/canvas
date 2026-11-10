import type { ObjectId } from '@canvas/schema';

import { selectionScopeOf, type SelectionScope } from './far-objects.js';
import type { ResizeAbility } from './handle-layout.js';
import type { OrientedBox } from './oriented-box.js';
import { resizeAspectOf, type ResizeAspect } from './resize-aspect.js';
import { SelectionFarCache } from './selection-far-cache.js';
import { resizeAbilityOf, type SelectionSource } from './selection-geometry.js';
import { isLockedSelection } from './selection-lock.js';
import {
  isChangeRelated,
  NO_RELATIONS,
  selectionRelationsOf,
  type SelectionRelations,
  type TouchedIds,
} from './selection-relations.js';

/**
 * The selection's frame on the document, whether it can be resized (and how it keeps its
 * aspect) and whether it is locked, each computed once and kept until the selection changes or a
 * change set touches it. Every select tool input reads them, and a hover (a move with no button down, which only picks
 * the cursor) must cost the same whatever the selection's size; a change set that touches
 * nothing the frame depends on (`isChangeRelated`) keeps them. With line end handles, it also
 * tells whether the frame offers its controls (not for a lone unlocked line or connector). Reads the
 * document, never a drag preview, so a preview leaves them as they are. Main thread.
 */
export class SelectionFrameCache {
  private readonly document: SelectionSource;
  private readonly farCache: SelectionFarCache;
  private ids: readonly ObjectId[] = [];
  private relations: SelectionRelations = NO_RELATIONS;
  private cachedFrame: { readonly frame: OrientedBox | undefined } | undefined;
  private scopeCache: SelectionScope | undefined;
  private canResizeCache: ResizeAbility | undefined;
  private resizeAspectCache: ResizeAspect | undefined;
  private isLockedCache: boolean | undefined;
  private hasFrameControlsCache: boolean | undefined;
  private readonly hasLineEndHandles: boolean;
  private changes = 0;

  /**
   * Starts with nothing selected.
   *
   * @param document - The document (not the preview).
   * @param hasLineEndHandles - Whether a lone unlocked line or connector is edited by its end
   *   handles, so its frame offers no controls (`SelectControllerOptions.hasLineEndHandles`).
   */
  constructor(document: SelectionSource, hasLineEndHandles = false) {
    this.document = document;
    this.farCache = new SelectionFarCache(document);
    this.hasLineEndHandles = hasLineEndHandles;
  }

  /**
   * The selection changed: forgets the frame and records what it depends on, O(selection ×
   * depth).
   *
   * @param ids - The selected ids.
   */
  select(ids: readonly ObjectId[]): void {
    this.ids = ids;
    this.relations = selectionRelationsOf(ids, this.document);
    this.invalidate();
  }

  /**
   * Takes a change set: when it touches the selection, its ancestors or a selected group's
   * subtree, forgets the frame and records the relations again; otherwise costs O(1) per
   * touched id and reads nothing (with a group selected, O(depth) per created or updated id).
   *
   * @param changes - The ids the change set touched.
   * @returns Whether the frame may have changed.
   */
  isAffectedBy(changes: TouchedIds): boolean {
    if (!isChangeRelated(changes, this.relations, this.document)) return false;
    this.relations = selectionRelationsOf(this.ids, this.document);
    this.farCache.invalidate(changes);
    this.clearDerived();
    return true;
  }

  /**
   * A revision that goes up whenever what the frame depends on may have changed (a new
   * selection, a change set touching it, the end of a gesture): what else is measured on the
   * selection's boxes, its outlines, is kept until it moves.
   *
   * @returns The revision.
   */
  get revision(): number {
    return this.changes;
  }

  /**
   * The selection's frame on the document.
   *
   * @returns The frame, world units, or undefined when nothing selected has geometry.
   */
  frame(): OrientedBox | undefined {
    this.cachedFrame ??= { frame: this.farCache.frame(this.ids) };
    return this.cachedFrame.frame;
  }

  /**
   * The selection as a transform sees it (`selectionScopeOf`): the far objects, which
   * the frame leaves out and a transform skips, and the near ones a transform changes. Worked out
   * once and kept like the frame, so a drag tests far-ness at its start and again only after a
   * change set touches the selection, never per pointer move.
   *
   * @returns The scope.
   */
  scope(): SelectionScope {
    this.scopeCache ??= selectionScopeOf(this.ids, this.document, this.farCache.farAmong(this.ids));
    return this.scopeCache;
  }

  /**
   * Whether the selection can be resized (`isResizable`).
   *
   * @returns Which handles the selection offers: all when every movable object stores a box or
   *   is a group, one axis's for a lone group with no length along the other, else none.
   */
  canResize(): ResizeAbility {
    this.canResizeCache ??= resizeAbilityOf(this.scope().near, this.document);
    return this.canResizeCache;
  }

  /**
   * How a resize of the selection keeps its aspect (`resizeAspectOf`).
   *
   * @returns Proportional by default at a lone image's drawn aspect, or for a selection holding
   *   an image; else other objects' rule.
   */
  resizeAspect(): ResizeAspect {
    this.resizeAspectCache ??= resizeAspectOf(this.ids, this.document, this.scope().near);
    return this.resizeAspectCache;
  }

  /**
   * Whether every selected object is locked (`isLockedSelection`).
   *
   * @returns True when the selection is locked as a whole.
   */
  isLocked(): boolean {
    this.isLockedCache ??= isLockedSelection(this.ids, this.document);
    return this.isLockedCache;
  }

  /**
   * Whether the frame offers resize handles and rotation bands: not for a lone unlocked line or
   * connector when they are edited by their end handles, since its frame is the box round its
   * ends (a connector follows the line's confirmed rule).
   *
   * @returns False for such a line or connector, else true.
   */
  hasFrameControls(): boolean {
    this.hasFrameControlsCache ??= !this.hasLineEndHandles || !this.isLoneUnlockedLine();
    return this.hasFrameControlsCache;
  }

  /**
   * Whether the selection is one unlocked line or connector.
   *
   * @returns True when it is.
   */
  private isLoneUnlockedLine(): boolean {
    const [only] = this.ids;
    const object =
      this.ids.length === 1 && only !== undefined ? this.document.get(only) : undefined;
    return (object?.type === 'line' || object?.type === 'connector') && !object.locked;
  }

  /** Forgets the frame and the resize, lock and control flags, as at the end of a gesture. */
  invalidate(): void {
    this.farCache.clear();
    this.clearDerived();
  }

  private clearDerived(): void {
    this.changes += 1;
    this.cachedFrame = undefined;
    this.scopeCache = undefined;
    this.canResizeCache = undefined;
    this.resizeAspectCache = undefined;
    this.isLockedCache = undefined;
    this.hasFrameControlsCache = undefined;
  }
}
