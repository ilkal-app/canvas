import {
  isStoredHidden,
  namedSwapTargets,
  resolveInstance,
  type BoardObject,
  type InstanceObject,
  type InstanceReferenceIssue,
  type ObjectId,
} from '@canvas/schema';

import { isRootMoveChanges, markRootMoveChanges } from '../scene/root-move-changes.js';
import type { SceneChangeSet, SceneSource } from '../scene/scene-source.js';

import {
  collectDefinition,
  type DefinitionGraph,
  type DefinitionSource,
} from './definition-source.js';
import { equalOverrides } from './equal-overrides.js';
import {
  isShownLayerChanged,
  mainLayerOf,
  withMainLayer,
  type MainLayer,
} from './instance-opacity.js';
import { ChildReads } from './instance-patch.js';
import { instancePlaceholder } from './instance-placeholder.js';
import { layoutRead, mainKey } from './main-reads.js';
import { PresetStep, type MainRead } from './preset-step.js';
import { ShownObjects } from './shown-objects.js';

/** Resolution state for a shown real instance. */
export interface InstanceStatus {
  /** Why part of the reference tree could not be expanded. */
  readonly issue?: InstanceReferenceIssue;
  /** Whether its main is a retained deleted definition. */
  readonly isMainRetired: boolean;
  /** Whether resolution produced no content, excluding the placeholder. */
  readonly isEmpty: boolean;
}

interface Expansion {
  input: InstanceObject;
  /** The input as the scene shows it: with its main's colour mode and opacity where it sets none. */
  shown: InstanceObject;
  /** Its main's colour mode and opacity when it was resolved (`mainLayerOf`). */
  readonly mainLayer: MainLayer;
  readonly ids: readonly ObjectId[];
  readonly dependencies: ReadonlySet<ObjectId>;
  /** What resolution read of each referenced main: the object, and its {@link mainKey}. */
  readonly mains: Map<ObjectId, MainRead>;
  /** The definition objects resolution read, as it read them: what a layout read. */
  readonly definition: ReadonlyMap<ObjectId, BoardObject>;
  readonly status: InstanceStatus;
}

/**
 * Recognises a transient instance address; stored ids cannot contain slashes.
 *
 * @param id - A scene id.
 * @returns Whether the id addresses virtual content.
 */
export function isVirtualObjectId(id: string): boolean {
  return id.includes('/');
}

/**
 * Expands instances at the scene boundary without copying children into the document.
 * The page feed calls expand first, then dependentsOf with whole-board changed ids.
 */
export class InstanceExpansion {
  private readonly shown = new ShownObjects();
  private readonly visible = new Set<ObjectId>();
  private readonly virtual = new Map<ObjectId, BoardObject>();
  private readonly owners = new Map<ObjectId, ObjectId>();
  private readonly instances = new Map<ObjectId, Expansion>();
  private readonly dependents = new Map<ObjectId, Set<ObjectId>>();

  /**
   * Creates an expansion over whole-board indexed definitions.
   *
   * @param definitions - Includes off-page and retained mains.
   */
  constructor(private readonly definitions: DefinitionSource) {}

  /**
   * The number of transient objects currently supplied to the scene.
   *
   * @returns The current virtual-object count.
   */
  get virtualCount(): number {
    return this.virtual.size;
  }

  /**
   * Maps a scene object to the real object tools may select or publish in presence.
   *
   * @param id - Real or virtual scene id.
   * @returns Its shown owner, or undefined for an unknown address.
   */
  ownerOf(id: string): ObjectId | undefined {
    const objectId = id as ObjectId;
    return this.owners.get(objectId) ?? (this.visible.has(objectId) ? objectId : undefined);
  }

  /**
   * Reads the latest resolution state.
   *
   * @param instanceId - Shown real instance.
   * @returns Its status, or undefined for non-instances and hidden objects.
   */
  statusOf(instanceId: ObjectId): InstanceStatus | undefined {
    return this.instances.get(instanceId)?.status;
  }

  /**
   * Applies a page change and supplies transient descendants to all scene consumers.
   *
   * @param changes - Page-scoped real objects, including tool previews.
   * @returns Changes with virtual additions/removals and retained mains hidden.
   */
  expand(changes: SceneChangeSet): SceneChangeSet {
    const ids = new Set([...changes.created, ...changes.updated, ...changes.deleted]);
    const ancestry = new Set<ObjectId>();
    for (const id of ids) {
      const old = this.shown.objects.get(id);
      const next = changes.get(id);
      if (
        old?.parentId !== next?.parentId ||
        (old?.type === 'component' && old.retired) !==
          (next?.type === 'component' && next.retired) ||
        isStoredHidden(old) !== isStoredHidden(next)
      )
        ancestry.add(id);
    }
    const affected = new Set([...ids, ...this.shown.descendants(ancestry)]);
    for (const id of ids) this.shown.set(id, changes.get(id));
    for (const id of this.shown.descendants(ancestry)) affected.add(id);
    const before = this.existing(affected);
    for (const id of [...changes.updated, ...changes.deleted]) before.add(id);
    const graphs = new Map<string, DefinitionGraph>();
    for (const id of [...affected]) {
      const object = this.shown.get(id);
      if (object === undefined) this.visible.delete(id);
      else this.visible.add(id);
      const previous = this.instances.get(id);
      if (object?.type !== 'instance') this.remove(id, affected, before);
      else if (previous === undefined || this.needsResolution(previous.input, object)) {
        this.resolve(object, graphs, affected, before);
      } else {
        previous.input = object;
        previous.shown = withMainLayer(object, previous.mainLayer);
      }
    }
    const result = this.changes(affected, before);
    return isRootMoveChanges(changes) && affected.size === ids.size
      ? markRootMoveChanges(result)
      : result;
  }

  /**
   * Invalidates shown instances affected by edits anywhere on the board.
   *
   * @param changed - Whole-board changed ids, including deleted objects.
   * @param shown - Current page source, including previews.
   * @returns Virtual changes, or undefined when no shown instance depends on the edits.
   */
  dependentsOf(changed: Iterable<ObjectId>, shown: SceneSource): SceneChangeSet | undefined {
    if (this.instances.size === 0) return undefined;
    // Each dependent instance, with the edited ids that reached it as themselves: an edit to a
    // leaf the instance already copies can be patched; anything else resolves it in full.
    const reached = new Map<ObjectId, Set<ObjectId> | 'full'>();
    const presets = new PresetStep();
    for (const id of changed) {
      const seen = new Set<ObjectId>();
      // Instances this id reached as itself; its own ancestors reaching them again add nothing.
      const direct = new Set<ObjectId>();
      let at: ObjectId | null = id;
      let key: string | undefined;
      presets.clear();
      while (at !== null && !seen.has(at)) {
        seen.add(at);
        for (const dependent of this.dependents.get(at) ?? []) {
          // A referenced main edited itself: re-resolve only if what resolution reads changed.
          // Reached from a changed descendant instead, its content changed, so always resolve.
          const read = at === id ? this.instances.get(dependent)?.mains.get(id) : undefined;
          const readKey = read?.key;
          if (readKey !== undefined && readKey === (key ??= mainKey(this.definitions.get(id)))) {
            continue;
          }
          const edits = reached.get(dependent);
          if (at !== id) {
            // Reached only through an ancestor (a new, moved or deleted child): the tree may
            // have changed, whatever else reached this instance in the same step.
            if (!direct.has(dependent)) reached.set(dependent, 'full');
          } else {
            direct.add(dependent);
            // A main whose presets alone changed reaches its own instances as the children whose
            // preset records changed, which they patch; anything else resolves them in full.
            const now = this.definitions.get(id);
            const presetChildren = presets.childrenEdited(
              id,
              read?.main,
              now,
              () => (key ??= mainKey(now)),
            );
            const isOwnMain = this.instances.get(dependent)?.input.mainId === id;
            const childEdits =
              presetChildren !== undefined && isOwnMain ? presetChildren : new Set([id]);
            if (edits === undefined) reached.set(dependent, new Set(childEdits));
            else if (edits !== 'full') for (const edit of childEdits) edits.add(edit);
          }
        }
        const object: BoardObject | undefined = shown.get(at) ?? this.definitions.get(at);
        at = object?.parentId ?? null;
      }
    }
    if (reached.size === 0) return undefined;
    const affected = new Set<ObjectId>();
    const before = new Set<ObjectId>();
    const graphs = new Map<string, DefinitionGraph>();
    const reads = new ChildReads(this.definitions);
    for (const [id, edits] of reached) {
      const object = shown.get(id);
      if (object?.type !== 'instance' || !this.visible.has(id)) continue;
      const shownBefore = this.instances.get(id)?.shown;
      if (edits === 'full' || !this.patch(object, edits, reads, presets, affected, before)) {
        this.resolve(object, graphs, affected, before);
      }
      const now = this.instances.get(id)?.shown;
      if (now !== undefined && isShownLayerChanged(shownBefore, now)) {
        before.add(id);
        affected.add(id);
      }
    }
    return this.changes(affected, before);
  }

  private patch(
    instance: InstanceObject,
    edits: ReadonlySet<ObjectId>,
    reads: ChildReads,
    presets: PresetStep,
    affected: Set<ObjectId>,
    before: Set<ObjectId>,
  ): boolean {
    const expansion = this.instances.get(instance.id);
    if (expansion === undefined || !equalOverrides(expansion.input, instance)) return false;
    const current = new Map<ObjectId, BoardObject>();
    for (const id of expansion.ids) {
      const object = this.virtual.get(id);
      if (object !== undefined) current.set(id, object);
    }
    // An edit that changes nothing a layout reads keeps every copy where it is, unless
    // a main's presets changed beyond paint too: they may hide, move or size a child.
    const isLayoutNeutral = (childId: ObjectId): boolean =>
      !presets.isLayoutChanged &&
      expansion.definition.has(childId) &&
      layoutRead(expansion.definition.get(childId)) === layoutRead(this.definitions.get(childId));
    const patched = reads.patch(instance, edits, current, isLayoutNeutral);
    if (patched === undefined) return false;
    // A main whose presets alone changed now reads as it is.
    for (const [id, read] of presets.reads) {
      if (expansion.mains.has(id)) expansion.mains.set(id, read);
    }
    for (const [id, read] of patched) {
      const object =
        read.type === 'instance'
          ? withMainLayer(read, mainLayerOf(this.definitions.get(read.mainId)))
          : read;
      if (equalOverrides(current.get(id), object)) continue;
      this.virtual.set(id, object);
      before.add(id);
      affected.add(id);
    }
    return true;
  }

  private needsResolution(before: InstanceObject, after: InstanceObject): boolean {
    return (
      before.mainId !== after.mainId ||
      before.width !== after.width ||
      before.height !== after.height ||
      // A rescaled instance lays its content out in another box and draws it larger.
      (before.scale ?? 1) !== (after.scale ?? 1) ||
      !equalOverrides(before.overrides, after.overrides) ||
      // A switched selection shows other presets.
      !equalOverrides(before.variant, after.variant)
    );
  }

  private existing(ids: Iterable<ObjectId>): Set<ObjectId> {
    return new Set([...ids].filter((id) => this.visible.has(id) || this.virtual.has(id)));
  }

  private remove(id: ObjectId, affected: Set<ObjectId>, before: Set<ObjectId>): void {
    const old = this.instances.get(id);
    if (old === undefined) return;
    for (const virtualId of old.ids) {
      before.add(virtualId);
      affected.add(virtualId);
      this.virtual.delete(virtualId);
      this.owners.delete(virtualId);
    }
    for (const dependency of old.dependencies) {
      const owners = this.dependents.get(dependency);
      owners?.delete(id);
      if (owners?.size === 0) this.dependents.delete(dependency);
    }
    this.instances.delete(id);
  }

  private resolve(
    instance: InstanceObject,
    graphs: Map<string, DefinitionGraph>,
    affected: Set<ObjectId>,
    before: Set<ObjectId>,
  ): void {
    const previous = new Map<ObjectId, BoardObject>();
    for (const id of this.instances.get(instance.id)?.ids ?? []) {
      const object = this.virtual.get(id);
      if (object !== undefined) previous.set(id, object);
    }
    this.remove(instance.id, affected, before);
    // The instance's own records may swap in further mains: instances naming the same
    // ones share a graph. Stored ids cannot contain a slash, so the key is unambiguous.
    const targets = [...new Set(namedSwapTargets(instance))].sort();
    const graphKey = [instance.mainId, ...targets].join('/');
    let graph = graphs.get(graphKey);
    if (graph === undefined) {
      graph = collectDefinition(this.definitions, instance.mainId, targets);
      graphs.set(graphKey, graph);
    }
    const resolved = resolveInstance(graph.board, instance, graph.children);
    const status: InstanceStatus = {
      isMainRetired: resolved.isMainRetired,
      isEmpty: resolved.objects.length === 0,
      ...(resolved.issue === undefined ? {} : { issue: resolved.issue }),
    };
    const objects = [...resolved.objects];
    if (status.issue !== undefined || (status.isMainRetired && status.isEmpty)) {
      objects.push(instancePlaceholder(instance));
    }
    for (const resolvedObject of objects) {
      const object =
        resolvedObject.type === 'instance'
          ? withMainLayer(
              resolvedObject,
              mainLayerOf(graph.board.objects.get(resolvedObject.mainId)),
            )
          : resolvedObject;
      this.virtual.set(object.id, object);
      this.owners.set(object.id, instance.id);
      // An unchanged copy stays as the scene holds it: one edited child of a main with a
      // thousand instances lists a thousand copies, not every copy of every child.
      if (equalOverrides(previous.get(object.id), object)) affected.delete(object.id);
      else affected.add(object.id);
    }
    for (const dependency of graph.dependencies) {
      let owners = this.dependents.get(dependency);
      if (owners === undefined) this.dependents.set(dependency, (owners = new Set()));
      owners.add(instance.id);
    }
    const mains = new Map<ObjectId, MainRead>();
    for (const id of graph.references) {
      const main = graph.board.objects.get(id);
      mains.set(id, { main, key: mainKey(main) });
    }
    const mainLayer = mainLayerOf(graph.board.objects.get(instance.mainId));
    this.instances.set(instance.id, {
      input: instance,
      shown: withMainLayer(instance, mainLayer),
      mainLayer,
      ids: objects.map((o) => o.id),
      dependencies: graph.dependencies,
      mains,
      definition: graph.board.objects,
      status,
    });
  }

  private changes(ids: ReadonlySet<ObjectId>, before: ReadonlySet<ObjectId>): SceneChangeSet {
    const created: ObjectId[] = [];
    const updated: ObjectId[] = [];
    const deleted: ObjectId[] = [];
    const get = (id: ObjectId): BoardObject | undefined =>
      this.virtual.get(id) ??
      (this.visible.has(id) ? (this.instances.get(id)?.shown ?? this.shown.get(id)) : undefined);
    for (const id of ids) {
      if (get(id) !== undefined) (before.has(id) ? updated : created).push(id);
      else if (before.has(id)) deleted.push(id);
    }
    return { created, updated, deleted, get };
  }
}
