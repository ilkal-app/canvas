import {
  applyInstanceOverride,
  buildChildIndex,
  createBoard,
  hasGeometry,
  laidInstanceSize,
  mergeOverrideRecords,
  resolveInstance,
  virtualObjectId,
  withRecordGeometry,
  type BoardObject,
  type InstanceObject,
  type InstanceOverrides,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

/** Reads the objects a preview starts from. */
export interface PreviewSource {
  /**
   * An object as stored.
   *
   * @param id - Its id.
   * @returns The object, if present.
   */
  get(id: ObjectId): BoardObject | undefined;
  /** The board's indexes: a hidden container's children are hidden with it. */
  readonly references: {
    /**
     * An object's direct children.
     *
     * @param id - The object.
     * @returns Their ids.
     */
    childrenOf(id: ObjectId): Iterable<ObjectId>;
  };
}

/** A main as one of its presets draws it: the children it changes, and those it hides. */
export interface PresetPreview {
  /** Children drawn with a record applied. */
  readonly objects: readonly BoardObject[];
  /** Children the preset hides, and everything in them: out of the scene while it shows. */
  readonly hiddenIds: readonly ObjectId[];
}

/**
 * A child and its stored descendants.
 *
 * @param source - The objects' children.
 * @param id - The child.
 * @returns Their ids, the child first.
 */
function subtreeIds(source: PreviewSource, id: ObjectId): ObjectId[] {
  return [
    id,
    ...[...source.references.childrenOf(id)].flatMap((child) => subtreeIds(source, child)),
  ];
}

/**
 * A main's children as one of its presets would draw them: the Variants section's
 * "Edit preset" previews these on the canvas through the tool previews, writing nothing. A
 * record at a child's own path applies to the child (`applyInstanceOverride`); `isHidden` takes
 * it and everything in it out of the scene, as an instance hides it; a record at a nested path (`inner/leaf`) is merged into that nested
 * instance's own overrides, which its expansion then draws. Geometry draws as an instance draws it:
 * a record moves and sizes its child and patches a layout, and a record at the main's
 * own id shows the main at the variant's size, its children without a record following their
 * constraints into it. Records at missing paths are skipped.
 * Pure.
 *
 * @param source - The objects as stored.
 * @param records - The preset's records by path.
 * @returns The children the preset changes, and those it hides.
 */
export function presetPreviewObjects(
  source: PreviewSource,
  records: InstanceOverrides,
): PresetPreview {
  const byChild = new Map<ObjectId, { own?: OverrideRecord; nested: InstanceOverrides }>();
  for (const [path, record] of Object.entries(records)) {
    const [first = '', ...rest] = path.split('/');
    const id = first as ObjectId;
    const entry = byChild.get(id) ?? { nested: {} };
    if (rest.length === 0) entry.own = record;
    else entry.nested = { ...entry.nested, [rest.join('/')]: record };
    byChild.set(id, entry);
  }
  const objects: BoardObject[] = [];
  const hiddenIds: ObjectId[] = [];
  const drawn = presetGeometry(source, records);
  for (const [id, { own, nested }] of byChild) {
    let object = drawn.get(id) ?? source.get(id);
    if (object === undefined) continue;
    drawn.delete(id);
    if (object.type === 'instance' && Object.keys(nested).length > 0) {
      const overrides: Record<string, OverrideRecord> = { ...object.overrides };
      for (const [path, record] of Object.entries(nested)) {
        overrides[path] = mergeOverrideRecords(overrides[path], record);
      }
      object = { ...object, overrides };
    }
    if (own !== undefined) object = applyInstanceOverride(object, own);
    if (own?.isHidden === true) hiddenIds.push(...subtreeIds(source, id));
    else objects.push(object);
  }
  // The main at its variant's size and the children its constraints moved into it.
  const hidden = new Set(hiddenIds);
  for (const [id, object] of drawn) if (!hidden.has(id)) objects.push(object);
  return { objects, hiddenIds };
}

/**
 * Whether two plain objects hold the same values, as JSON.
 *
 * @param left - One object.
 * @param right - The other.
 * @returns True when they serialise alike.
 */
function equalJson(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The id of the stand-in instance a preview resolves: no stored object can have it. */
const PREVIEW_ID = '~preset-preview' as ObjectId;

/**
 * The objects a preset's geometry and layout change: the main's content placed as an
 * instance of it draws them, through `resolveInstance` on a stand-in with the preset's records,
 * so a record moves and sizes its child, an `autoLayout` patch applies, the auto-layout lays the
 * siblings out again (a hidden child leaving the flow), and a root record shows the main at the
 * variant's size with the children that have no record following their constraints into it.
 * Empty when no record carries geometry and no auto-layout container could reflow.
 *
 * @param source - The objects as stored.
 * @param records - The preset's records by path.
 * @returns The changed objects by id, placed but without the records' content applied.
 */
function presetGeometry(
  source: PreviewSource,
  records: InstanceOverrides,
): Map<ObjectId, BoardObject> {
  const changed = new Map<ObjectId, BoardObject>();
  const main = mainOf(source, records);
  if (main?.type !== 'component') return changed;
  const stored = definitionObjects(source, main.id);
  const isReflowing = stored.some((object) => 'autoLayout' in object && object.autoLayout);
  if (!isReflowing && !Object.values(records).some((record) => hasGeometry(record))) {
    return changed;
  }
  // The main alone, its presets left out: the preview shows these records, not its defaults'.
  const bare = { ...main, variantAxes: undefined, variantPresets: undefined };
  const board = createBoard([bare, ...stored.filter(({ id }) => id !== main.id)]);
  const children = buildChildIndex(board);
  const reader = {
    get: (id: ObjectId) => board.objects.get(id),
    childrenOf: (id: ObjectId) => children.get(id) ?? [],
  };
  const standIn: InstanceObject = {
    id: PREVIEW_ID,
    type: 'instance',
    parentId: main.parentId,
    pageId: main.pageId,
    x: main.x,
    y: main.y,
    z: main.z,
    rotation: main.rotation,
    locked: false,
    createdBy: main.createdBy,
    createdAt: 0,
    updatedAt: 0,
    width: main.width,
    height: main.height,
    mainId: main.id,
    overrides: records,
  };
  const size = laidInstanceSize(reader, standIn, bare);
  // The main at the variant's size, with its layout as the root record patches it.
  const { autoLayout } = withRecordGeometry(board, bare, [], records).main;
  const drawnMain = { ...main, ...size, ...(autoLayout === undefined ? {} : { autoLayout }) };
  if (!equalJson(drawnMain, main)) changed.set(main.id, drawnMain);
  const resolved = new Map(
    resolveInstance(board, { ...standIn, ...size }, children, records).objects.map((object) => [
      object.id,
      object,
    ]),
  );
  for (const object of stored) {
    const placed = resolved.get(virtualObjectId(PREVIEW_ID, object.id) as ObjectId);
    if (placed === undefined || object.id === main.id) continue;
    const next = placedAs(object, placed);
    if (!equalJson(next, object)) changed.set(object.id, next);
  }
  return changed;
}

/**
 * A stored object where its resolved copy is placed. A box takes the copy's box and patched layout.
 * Any other object (a group, line, path or connector) takes the copy whole, since the constraints
 * may have mapped its points or network as well as its position. Its identity is kept, a
 * connector's attached ends keep their real targets, and the content the preset changes is the
 * same in the copy as the records then apply.
 *
 * @param object - The stored object.
 * @param placed - Its resolved copy.
 * @returns The object as the preview draws it.
 */
function placedAs(object: BoardObject, placed: BoardObject): BoardObject {
  const { id, parentId, pageId, z } = object;
  if (object.type === 'connector' && placed.type === 'connector') {
    // An attached end names its target by its real id: the resolver's names are virtual.
    const from = object.from.kind === 'object' ? object.from : placed.from;
    const to = object.to.kind === 'object' ? object.to : placed.to;
    return { ...placed, id, parentId, pageId, z, from, to };
  }
  if (!('width' in object) || !('width' in placed)) return { ...placed, id, parentId, pageId, z };
  return {
    ...object,
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    ...('autoLayout' in placed && placed.autoLayout !== undefined
      ? { autoLayout: placed.autoLayout }
      : {}),
  };
}

/**
 * The objects an instance of a main reads: the main, its descendants, and every main a nested
 * instance in them names, with theirs, so the stand-in resolves as a placed instance would.
 *
 * @param source - The objects as stored.
 * @param mainId - The main.
 * @returns The objects, the main first.
 */
function definitionObjects(source: PreviewSource, mainId: ObjectId): BoardObject[] {
  const objects = new Map<ObjectId, BoardObject>();
  const pending = [mainId];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const objectId of subtreeIds(source, id)) {
      const object = source.get(objectId);
      if (object === undefined || objects.has(objectId)) continue;
      objects.set(objectId, object);
      if (object.type === 'instance' && !objects.has(object.mainId)) pending.push(object.mainId);
    }
  }
  return [...objects.values()];
}

/**
 * The main a preset's records belong to: the component a recorded child sits in, or the main
 * itself when a record is at its own id.
 *
 * @param source - The objects as stored.
 * @param records - The preset's records by path.
 * @returns The main, if a path reaches one.
 */
function mainOf(source: PreviewSource, records: InstanceOverrides): BoardObject | undefined {
  for (const path of Object.keys(records)) {
    let object = source.get((path.split('/')[0] ?? '') as ObjectId);
    for (let depth = 0; object !== undefined && depth < MAX_DEPTH; depth += 1) {
      if (object.type === 'component') return object;
      object = object.parentId === null ? undefined : source.get(object.parentId);
    }
  }
  return undefined;
}

/** How far up from a recorded child {@link mainOf} looks: a guard against a malformed cycle. */
const MAX_DEPTH = 64;
