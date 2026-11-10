import type { DocumentStore } from '@canvas/document';
import {
  ConnectorPlacements,
  DrawableGate,
  hitPoint,
  SceneSpatialIndex,
  type ConnectorTargetSource,
  type HitPointOptions,
  type SceneChangeSet,
  type WorldBounds,
} from '@canvas/engine';
import { isStoredHidden, type BoardObject, type ObjectId, type Point } from '@canvas/schema';

import type { IndexedObject } from './board-view.js';

/** The ids one store change set touched. */
interface TouchedIds {
  readonly created: readonly ObjectId[];
  readonly updated: readonly ObjectId[];
  readonly deleted: readonly ObjectId[];
}

/**
 * Whether an object takes itself and its subtree out of the scene: a retired main, or a layer
 * stored hidden.
 *
 * @param object - The object.
 * @returns Whether it conceals its subtree.
 */
function isConcealing(object: BoardObject): boolean {
  return (object.type === 'component' && object.retired) || isStoredHidden(object);
}

/**
 * The spatial index hit testing, marquees, snapping and zoom to fit query, kept in step with the
 * document at once (it must answer between frames), fed through an engine `DrawableGate` as the
 * renderer's scene is: an object whose stored geometry cannot be drawn (a number that is
 * not finite or past its range, a negative size, a place past the drawable extent, an undrawable
 * frame or group around it) is never hit, marquee-selected, snapped to or counted in zoom to fit.
 * The gate's verdicts also decide what the select tool outlines (`isDrawable`), so the selection
 * frame agrees with the picture. Connectors are read placed (`get`, engine `ConnectorPlacements`,
 *), so the index bounds them and hit testing picks them by the route they draw, and a
 * change to an object re-indexes the connectors attached to it, to anything below it, or to a
 * group above it (before or after the change). Create it before anything else that subscribes to
 * the store (the select tool), so its verdicts are current when their listeners run. Main thread.
 */
export class DocumentHitIndex {
  /** The index, in step with the store. */
  readonly index = new SceneSpatialIndex();
  private readonly gate = new DrawableGate();
  private readonly store: DocumentStore;
  private readonly placements = new ConnectorPlacements();
  private readonly targets: ConnectorTargetSource;
  /** Each object's parent as last indexed, for the groups a deletion or reparenting leaves. */
  private readonly parents = new Map<ObjectId, ObjectId>();
  /** What an object's colour tokens resolve to, as the select tool and renderer read them. */
  private paletteOf: HitPointOptions['paletteOf'];
  /** The connectors on the board: none, and a change re-indexes no connector. */
  private readonly connectors = new Set<ObjectId>();
  private readonly concealing = new Set<ObjectId>();
  /** Objects a preview takes out of the scene: not hit, picked or outlined meanwhile. */
  private previewHidden: ReadonlySet<ObjectId> = new Set();
  private readonly stopListening: () => void;

  /**
   * Indexes the document as it is and starts following it.
   *
   * @param store - The document.
   */
  constructor(store: DocumentStore) {
    this.store = store;
    this.targets = {
      get: (id) => store.get(id),
      childrenOf: (id) => store.references.childrenOf(id),
    };
    this.apply({ created: [...store.read().objects.keys()], updated: [], deleted: [] });
    this.stopListening = store.subscribe((changes) => {
      this.apply(changes);
    });
  }

  /**
   * The objects whose drawn bounds meet a world rectangle, with those bounds (the
   * board view's `objectsIn`).
   *
   * @param bounds - The rectangle.
   * @returns Each object met and its bounds.
   */
  objectsIn(bounds: WorldBounds): readonly IndexedObject[] {
    return this.index.searchRect(bounds).flatMap((id) => {
      const box = this.index.boundsOf(id);
      return box === undefined ? [] : [{ id, bounds: box }];
    });
  }

  /**
   * An object's drawn bounds as the index holds them, a connector placed on its targets (
   * the selection popover beside a connector, whose stored ends name objects, not points).
   *
   * @param id - The object.
   * @returns Its bounds, world units, or undefined when the index has none.
   */
  boundsOf(id: ObjectId): WorldBounds | undefined {
    return this.index.boundsOf(id);
  }

  /**
   * The objects drawn under a world point, topmost first (the link a ⌘-click opens):
   * the engine's exact hit (`hitPoint`: fills, strokes, clipping), as the select tool picks.
   *
   * @param point - The point, world units.
   * @param zoom - The camera zoom, for the pick tolerance.
   * @returns The ids, topmost first; groups never (they have no geometry of their own).
   */
  idsAt(point: Point, zoom: number): readonly ObjectId[] {
    const { paletteOf } = this;
    return hitPoint(this.index, this, point, { zoom, ...(paletteOf && { paletteOf }) });
  }

  /**
   * Resolves objects' colour tokens with the document's live palette in {@link idsAt}, as the
   * select tool does (a fill whose token is transparent in the shown mode is not hit).
   *
   * @param paletteOf - The palette of an object, from `hitPaletteOf`.
   */
  usePalette(paletteOf: NonNullable<HitPointOptions['paletteOf']>): void {
    this.paletteOf = paletteOf;
  }

  /**
   * An object as the index holds it: as the store has it, a connector placed on its targets as
   * they are now (a copy carrying its route, which hit testing's geometry reads). Hit testing
   * reads objects through this, so it agrees with the index.
   *
   * @param id - The object.
   * @returns The object, or `undefined` when the store has none.
   */
  get(id: ObjectId): BoardObject | undefined {
    const object = this.store.get(id);
    if (this.previewHidden.has(id) || this.isConcealed(object)) return undefined;
    return object?.type === 'connector' ? this.placements.place(object, this.targets) : object;
  }

  /**
   * Whether an object may be drawn, hit and outlined: false for one a preview hides, one
   * concealed (it or an ancestor is a retired main or a hidden layer), or one the gate holds
   * undrawable after the latest change. O(depth): the concealment is read live.
   *
   * @param id - The object.
   * @returns The gate's verdict.
   */
  isDrawable(id: ObjectId): boolean {
    return (
      !this.previewHidden.has(id) &&
      !this.isConcealed(this.store.get(id)) &&
      this.gate.isDrawable(id)
    );
  }

  /**
   * Sets the objects a preview takes out of the scene (a main's child its preset hides,
   *), which hit testing then passes over as it does an undrawable one, until the next
   * call.
   *
   * @param ids - The objects hidden now.
   */
  setPreviewHidden(ids: ReadonlySet<ObjectId>): void {
    this.previewHidden = new Set(ids);
  }

  /** Stops following the document. */
  destroy(): void {
    this.stopListening();
  }

  /**
   * Whether an object is out of the scene: it or an ancestor is a retired main or a hidden layer.
   * Read live from the store, so a reader that runs before this index hears of a change
   * still sees it. A root object, the common case in a large drag, costs no further read.
   *
   * @param object - The object, as the store has it.
   * @returns Whether it is concealed.
   */
  private isConcealed(object: BoardObject | undefined): boolean {
    if (object === undefined) return false;
    if (isConcealing(object)) return true;
    if (object.parentId === null) return false;
    const seen = new Set<ObjectId>([object.id]);
    let ancestor = this.store.get(object.parentId);
    while (ancestor !== undefined && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      if (isConcealing(ancestor)) return true;
      ancestor = ancestor.parentId === null ? undefined : this.store.get(ancestor.parentId);
    }
    return false;
  }

  private apply(touched: TouchedIds): void {
    const rerouted = this.reroutedBy(touched);
    const updated = new Set([...touched.updated, ...rerouted]);
    // A retirement or visibility flip can hide or reveal descendants the store did not list. A
    // subtree moved under an already retired main or hidden layer keeps stale entries, but `get` refuses them, so a hit there
    // resolves to nothing rather than to a hidden object.
    const visibility = new Set<ObjectId>();
    for (const id of [...touched.created, ...touched.updated, ...touched.deleted]) {
      const object = this.store.get(id);
      const isNowConcealing = object !== undefined && isConcealing(object);
      if (isNowConcealing !== this.concealing.has(id)) visibility.add(id);
      if (isNowConcealing) this.concealing.add(id);
      else this.concealing.delete(id);
    }
    for (const id of visibility) {
      for (const child of this.store.references.childrenOf(id)) visibility.add(child);
      updated.add(id);
    }
    const changes: SceneChangeSet = {
      created: touched.created,
      updated: [...updated],
      deleted: touched.deleted,
      get: (id) => this.get(id),
    };
    this.index.apply(this.gate.filter(changes));
  }

  /**
   * Records what a change set touched (parents, connectors) and finds the connectors it moves
   * without listing them: those attached to a touched object, to anything below one, or to a
   * group above one before or after the change. O(touched × depth), plus the subtrees of touched
   * objects while the board holds a connector.
   *
   * @param touched - The change set's ids.
   * @returns The connectors to re-index.
   */
  private reroutedBy(touched: TouchedIds): ObjectId[] {
    const listed = new Set([...touched.created, ...touched.updated, ...touched.deleted]);
    const previousParents = new Map<ObjectId, ObjectId | undefined>();
    for (const id of listed) {
      const object = this.store.get(id);
      previousParents.set(id, this.parents.get(id));
      if (object?.parentId) this.parents.set(id, object.parentId);
      else this.parents.delete(id);
      if (object?.type === 'connector') this.connectors.add(id);
      else if (this.connectors.delete(id)) this.placements.forget(id);
    }
    if (this.connectors.size === 0) return [];
    const found = new Set<ObjectId>();
    const { references } = this.store;
    const add = (target: ObjectId): void => {
      for (const connector of references.connectorsAttachedTo(target)) {
        if (!listed.has(connector)) found.add(connector);
      }
    };
    const walkedUp = new Set<ObjectId>();
    const addGroupsAbove = (parent: ObjectId | undefined): void => {
      for (
        let id = parent;
        id && !walkedUp.has(id);
        id = this.store.get(id)?.parentId ?? undefined
      ) {
        walkedUp.add(id);
        if (this.store.get(id)?.type === 'group') add(id);
      }
    };
    const walkedDown = new Set<ObjectId>();
    for (const id of listed) {
      add(id);
      addGroupsAbove(previousParents.get(id));
      addGroupsAbove(this.parents.get(id));
      const pending = [...references.childrenOf(id)];
      for (let child = pending.pop(); child !== undefined; child = pending.pop()) {
        if (walkedDown.has(child) || listed.has(child)) continue;
        walkedDown.add(child);
        add(child);
        pending.push(...references.childrenOf(child));
      }
    }
    return [...found];
  }
}
