import {
  InstanceExpansion,
  isVirtualObjectId,
  type DefinitionSource,
  type SceneChangeSet,
} from '@canvas/engine';
import {
  buildChildIndex,
  createBoard,
  isImagePaint,
  mainClosure,
  namedSwapTargets,
  type AssetId,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

/**
 * Maps scene candidates to the real objects that own them (ruling 9): a virtual
 * instance descendant (`inst/child`, `inst/nested/child`) to its shown instance, the id before
 * the first `/`; every stored id to itself. Stored ids cannot contain a slash.
 *
 * @param candidates - Scene ids, virtual ids included.
 * @returns The owners, once each, in first-seen order.
 */
export function candidateOwners(candidates: Iterable<ObjectId>): ObjectId[] {
  const owners = new Set<ObjectId>();
  for (const id of candidates) {
    owners.add(isVirtualObjectId(id) ? (id.slice(0, id.indexOf('/')) as ObjectId) : id);
  }
  return [...owners];
}

/**
 * Collects what the shown instances need to resolve again (ruling 9): each referenced
 * main, wherever it is (another page, retired), its definition content, the mains of the
 * instances that content holds and every main a record or preset names as a swap target
 * (`mainClosure`), recursively, and every ancestor of those mains so the result imports
 * as a valid board. Comments are left out. Reads no other object; never expands an instance.
 *
 * @param definitions - The whole board, every page included.
 * @param shown - The objects that draw; those are left out of the result.
 * @returns The closure's objects that are not shown, each after its ancestors; empty when no
 *   shown object is an instance.
 */
export function definitionClosure(
  definitions: Board,
  shown: readonly BoardObject[],
): BoardObject[] {
  const roots: ObjectId[] = [];
  for (const object of shown) {
    if (object.type === 'instance') roots.push(object.mainId, ...namedSwapTargets(object));
  }
  if (roots.length === 0) return [];
  const isShown = new Set(shown.map((object) => object.id));
  const children = buildChildIndex(definitions);
  const reader = {
    get: (id: ObjectId) => definitions.objects.get(id),
    childrenOf: (id: ObjectId) => children.get(id) ?? [],
  };
  const closure = new Map<ObjectId, BoardObject>();
  // Ids placed in the result, shown or not, so each ancestor chain is walked once.
  const placed = new Set<ObjectId>();
  const add = (object: BoardObject): void => {
    placed.add(object.id);
    if (!isShown.has(object.id)) closure.set(object.id, object);
  };
  for (const id of mainClosure(reader, roots)) {
    const object = definitions.objects.get(id);
    if (object === undefined || object.type === 'comment' || placed.has(id)) continue;
    const ancestors: BoardObject[] = [];
    const path = new Set<ObjectId>([id]);
    let parentId = object.parentId;
    while (parentId !== null && !placed.has(parentId) && !path.has(parentId)) {
      path.add(parentId);
      const parent = definitions.objects.get(parentId);
      if (parent === undefined) break;
      ancestors.push(parent);
      parentId = parent.parentId;
    }
    for (const ancestor of ancestors.reverse()) add(ancestor);
    add(object);
  }
  return [...closure.values()];
}

/**
 * Lists the image assets a projection draws or may draw: every image object's asset, every
 * shape's or frame's image paint's, and every instance override's replacement asset
 * (ruling 9).
 *
 * @param objects - The projection's objects.
 * @returns Each asset id once.
 */
export function projectionAssetIds(objects: Iterable<BoardObject>): Set<AssetId> {
  const assets = new Set<AssetId>();
  for (const object of objects) {
    if (object.type === 'image') assets.add(object.assetId);
    // An image paint on a shape's fill or a frame's background shows its asset too.
    const paint =
      object.type === 'shape' ? object.fill : object.type === 'frame' ? object.background : null;
    if (isImagePaint(paint)) assets.add(paint.assetId);
    if (object.type !== 'instance') continue;
    for (const record of Object.values(object.overrides)) {
      if (record.assetId !== undefined) assets.add(record.assetId);
    }
  }
  return assets;
}

/**
 * Feeds a restored projection through an `InstanceExpansion` over its own objects, as the live
 * feed does over the whole board (ruling 9): instances draw their mains' content under
 * virtual ids, retired mains and objects that only define instances do not draw.
 *
 * @param objects - Every restored object, definitions included.
 * @param shownIds - The objects that draw; absent, every object.
 * @returns The scene's first change set: every drawn id created, virtual ids included.
 */
export function expandPreviewScene(
  objects: readonly BoardObject[],
  shownIds?: ReadonlySet<ObjectId>,
): SceneChangeSet {
  const board = createBoard(objects);
  const children = buildChildIndex(board);
  const instances = new Map<ObjectId, ObjectId[]>();
  for (const object of objects) {
    if (object.type !== 'instance') continue;
    const placements = instances.get(object.mainId);
    if (placements === undefined) instances.set(object.mainId, [object.id]);
    else placements.push(object.id);
  }
  const definitions: DefinitionSource = {
    get: (id) => board.objects.get(id),
    childrenOf: (id) => children.get(id) ?? [],
    instancesOf: (mainId) => instances.get(mainId) ?? [],
  };
  return new InstanceExpansion(definitions).expand({
    created: objects
      .map((object) => object.id)
      .filter((id) => shownIds === undefined || shownIds.has(id)),
    updated: [],
    deleted: [],
    get: (id) => board.objects.get(id),
  });
}
