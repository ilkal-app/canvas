import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import type { FrameContext, FrameStage } from '../scene/frame-context.js';
import type { Frame } from '../scene/frame.js';
import { isRootMoveChanges } from '../scene/root-move-changes.js';
import type { SceneHierarchy } from '../scene/scene-hierarchy.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import { ConnectorLinks } from './connector-links.js';
import type { ConnectorTargetSource } from './connector-placement.js';
import { ConnectorPlacements } from './connector-placements.js';

const NO_DEPENDENTS = { connectors: [], below: new Set<ObjectId>() } as const;

/**
 * Hands every connector to the scene with its shape (a connector is re-routed
 * when either end moves): it wraps the frame's `collectChanges` stage, outermost, so every
 * reader of a change set (the scene and its passes, the culler's index, the z-order segments)
 * reads a connector through `get` as a copy carrying the shape placed on the document as it is
 * now (`placedConnector`, `resolveConnectorShape`). Routes are derived when drawn, never stored.
 *
 * A change to an object re-routes only the connectors attached to it ({@link ConnectorLinks}):
 * to it, to anything below it (a group or frame that moves carries its children), or to a group
 * above it (whose derived bounds the change moves). Those connectors are collected in the same
 * frame, as a second change set after the first, so a host's root move keeps its fast path, and
 * a remote change re-routes like a local one. A frame with no change, or one changing nothing
 * attached to, does no connector work. A re-placed connector whose shape is unchanged is handed
 * as the same value, so its readers find nothing to do. Rendering thread only.
 */
export class ConnectorRouting {
  private readonly links = new ConnectorLinks();
  private readonly placements = new ConnectorPlacements();

  /**
   * Whether a connector that is not one of the objects is attached to any of them, so moving
   * them re-routes it.
   *
   * @param ids - The objects.
   * @returns True when one has such a connector on it.
   */
  hasConnectorsOutside(ids: ReadonlySet<ObjectId>): boolean {
    if (this.links.size === 0) return false;
    for (const id of ids)
      for (const connector of this.links.connectorsOn(id)) if (!ids.has(connector)) return true;
    return false;
  }

  /**
   * Hooks into a frame: wraps `collectChanges`. Install after every other wrapper of that stage
   * (the culler's, the passes'), so this one runs first and they all read placed connectors.
   *
   * @param frame - The renderer's frame.
   */
  install(frame: Frame): void {
    frame.wrapStage('collectChanges', (inner) => ({
      name: inner.name,
      run: (context) => {
        this.collect(context, inner);
      },
    }));
  }

  private collect(context: FrameContext, inner: FrameStage): void {
    const changes = context.changes.drain();
    if (!changes) {
      inner.run(context);
      return;
    }
    const listed = new Set([...changes.created, ...changes.updated, ...changes.deleted]);
    let hasConnector = false;
    for (const id of listed) {
      const object = changes.get(id);
      if (object?.type === 'connector') hasConnector = true;
      else if (object === undefined) this.placements.forget(id);
      this.links.observe(id, object);
    }
    const hierarchy = context.scene.hierarchy;
    const { connectors, below } = this.dependentsOf(listed, changes, hierarchy);
    const isPlacing = hasConnector || this.placements.size > 0 || connectors.length > 0;
    const placing = isPlacing ? this.placing(changes, listed, hierarchy) : changes;
    // What the scene was handed for connectors it reads again as descendants of listed objects.
    const before = new Map<ObjectId, ConnectorObject | undefined>();
    for (const id of connectors) if (below.has(id)) before.set(id, this.placements.lastPlaced(id));
    // A host's root move lists only root leaves, so no connector is read through it unless listed.
    const canPassOn = !hasConnector && isRootMoveChanges(changes);
    context.changes.push(canPassOn ? changes : placing);
    inner.run(context);
    // Every reader sees the rest; a descendant only when its shape changed (a frame holding it,
    // not its targets, moved), as readers that skip descendants (the path pass) must.
    const updated = connectors.filter(
      (id) => !before.has(id) || placing.get(id) !== before.get(id),
    );
    if (updated.length === 0) return;
    const get = (id: ObjectId): BoardObject | undefined => placing.get(id);
    context.changes.push({ created: [], updated, deleted: [], get });
    inner.run(context);
  }

  /**
   * The connectors a change set re-routes that it does not list: those on a listed object, on
   * anything below one (as the scene last applied it), or on a group above one (before or after
   * the change), and those below a listed object themselves, whose ends stay with targets that
   * may not move. Those below a listed object the scene reads again with it, as its descendants.
   *
   * @param listed - The ids the change set lists.
   * @param changes - The change set.
   * @param hierarchy - The scene's parent tree, before the change set is applied.
   * @returns The connectors' ids, and every object below a listed one.
   */
  private dependentsOf(
    listed: ReadonlySet<ObjectId>,
    changes: SceneChangeSet,
    hierarchy: SceneHierarchy,
  ): { readonly connectors: readonly ObjectId[]; readonly below: ReadonlySet<ObjectId> } {
    if (this.links.size === 0) return NO_DEPENDENTS;
    const found = new Set<ObjectId>();
    const add = (target: ObjectId): void => {
      for (const connector of this.links.connectorsOn(target)) {
        if (!listed.has(connector)) found.add(connector);
      }
    };
    const walkedUp = new Set<ObjectId>();
    const addGroupsAbove = (parent: ObjectId | null | undefined): void => {
      for (let id = parent; id && !walkedUp.has(id); id = changes.get(id)?.parentId) {
        walkedUp.add(id);
        if (changes.get(id)?.type === 'group') add(id);
      }
    };
    const walkedDown = new Set<ObjectId>();
    for (const id of listed) {
      add(id);
      addGroupsAbove(changes.get(id)?.parentId);
      addGroupsAbove(hierarchy.parentOf(id));
      const pending = [...hierarchy.childrenOf(id)];
      for (let child = pending.pop(); child !== undefined; child = pending.pop()) {
        if (walkedDown.has(child) || listed.has(child)) continue;
        walkedDown.add(child);
        add(child);
        // A connector carried by what moved: its attached ends stay with targets that may not.
        if (this.links.hasAttachedEnds(child)) found.add(child);
        pending.push(...hierarchy.childrenOf(child));
      }
    }
    return { connectors: [...found], below: walkedDown };
  }

  /**
   * A change set that reads connectors placed: each connector's `get` gives a value carrying its
   * shape, the same value while neither it nor its shape changes. Other objects read through.
   *
   * @param changes - The change set.
   * @param listed - The ids it lists, whose parents it may change.
   * @param hierarchy - The scene's parent tree, for a group target's children.
   * @returns The change set to hand on.
   */
  private placing(
    changes: SceneChangeSet,
    listed: ReadonlySet<ObjectId>,
    hierarchy: SceneHierarchy,
  ): SceneChangeSet {
    let listedByParent: Map<ObjectId, ObjectId[]> | undefined;
    const source: ConnectorTargetSource = {
      get: (id) => changes.get(id),
      // The scene's tree, with the listed objects where the change set puts them: correct before,
      // during and after the scene applies it.
      childrenOf: (id) => {
        if (!listedByParent) {
          listedByParent = new Map();
          for (const listedId of listed) {
            const parentId = changes.get(listedId)?.parentId;
            if (!parentId) continue;
            listedByParent.set(parentId, [...(listedByParent.get(parentId) ?? []), listedId]);
          }
        }
        const kept = [...hierarchy.childrenOf(id)].filter((child) => !listed.has(child));
        return [...kept, ...(listedByParent.get(id) ?? [])];
      },
    };
    const values = new Map<ObjectId, BoardObject | undefined>();
    const get = (id: ObjectId): BoardObject | undefined => {
      if (values.has(id)) return values.get(id);
      const object = changes.get(id);
      if (object?.type !== 'connector') return object;
      const value = this.placements.place(object, source);
      values.set(id, value);
      return value;
    };
    return {
      created: changes.created,
      updated: changes.updated,
      deleted: changes.deleted,
      get,
    };
  }
}
