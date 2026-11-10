import { sortedSiblings, type BoardReader } from '@canvas/document';
import {
  buildChildIndex,
  definitionContent,
  editableOverrideFields,
  effectiveOverrides,
  effectiveOverridesOf,
  mainClosure,
  MAX_INSTANCE_DEPTH,
  namedSwapTargets,
  slotExpansion,
  type Board,
  type BoardObject,
  type ChildIndex,
  type InstanceObject,
  type InstanceOverrides,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

/** Where a nested instance (a slot) sits in the expansion, for its swap picker. */
export interface SlotPlacement {
  /** The slot as its main stores it, with the main it shows in `mainId` (the row's `source`). */
  readonly instance: InstanceObject;
  /** The main the slot stores, which choosing again clears the swap. */
  readonly storedMainId: ObjectId;
  /** The mains expanded above the slot, outermost (the instance's own) first. */
  readonly ancestorMains: readonly ObjectId[];
}

/** One overridable child of an instance's main, as the instance section lists it. */
export interface InstanceOverrideRow {
  /** Its override path: the nested instance ids leading to it, then its id, joined by `/`. */
  readonly path: string;
  /** How deep it sits: 0 for a child of the main, one more per container or nested instance. */
  readonly depth: number;
  /**
   * The child as the main stores it; a nested instance with its effective main (a swap where it
   * can expand) in `mainId`.
   */
  readonly source: BoardObject;
  /** The fields one may override on it (`editableOverrideFields`). */
  readonly fields: readonly (keyof OverrideRecord)[];
  /** What the instance overrides at its path, if anything. */
  readonly override: OverrideRecord | undefined;
  /** For a nested instance, its stored main and the mains above it; absent for other rows. */
  readonly slot?: SlotPlacement;
  /**
   * What the presets of the chosen variant values set at its path, composed: the
   * instance's main's, and a nested instance's own main's at the value it shows, under
   * `override`; undefined when they set nothing there.
   */
  readonly preset?: OverrideRecord | undefined;
}

/**
 * The part of a board that expanding some mains may read, as a board of its own (`mainClosure`:
 * each main's content, the mains its nested instances store and every main a record or preset
 * names as a swap target), without indexing the whole board.
 *
 * @param board - The document.
 * @param roots - The mains, and any object whose named swap targets count.
 * @returns The board and its child index.
 */
export function closureBoard(
  board: BoardReader,
  roots: Iterable<ObjectId>,
): { readonly board: Board; readonly children: ChildIndex } {
  const ids = mainClosure(
    { get: (id) => board.get(id), childrenOf: (id) => board.references.childrenOf(id) },
    roots,
  );
  const objects = new Map<ObjectId, BoardObject>();
  for (const id of ids) {
    const object = board.get(id);
    if (object !== undefined) objects.set(id, object);
  }
  const closure = { objects };
  return { board: closure, children: buildChildIndex(closure) };
}

/** What one walk of the rows carries. */
interface RowWalk {
  /** The document. */
  readonly reader: BoardReader;
  /** The mains the walk may reach, as a board. */
  readonly board: Board;
  /** That board's child index. */
  readonly children: ChildIndex;
  /** The instance's own records. */
  readonly overrides: InstanceObject['overrides'];
  /** The rows so far. */
  readonly rows: InstanceOverrideRow[];
}

/**
 * The presets below a slot that its own records swapped: the level's presets read
 * through that swap, so those at the stored main's children carry over to the swapped-in main's
 * by layer name, as `resolveInstance` draws them; none when the swap cannot expand here.
 *
 * @param walk - The rows walk, for its board and child index.
 * @param bare - The slot with no records, at the variant it shows.
 * @param level - The level's presets for the slot's expansion (`presetsAt`).
 * @param mainId - The main the slot shows.
 * @param mains - The mains expanded above the slot.
 * @param presets - The level's chosen presets, relative to its main.
 * @returns The presets below the slot, relative to it.
 */
function swappedPresets(
  walk: RowWalk,
  bare: InstanceObject,
  level: InstanceOverrides,
  mainId: ObjectId,
  mains: readonly ObjectId[],
  presets: InstanceOverrides,
): InstanceOverrides {
  const swap = { ...level, [bare.id]: { ...level[bare.id], mainId } };
  const swapped = slotExpansion(walk.board, bare, swap, mains, walk.children, presets);
  return swapped.mainId === mainId ? swapped.overrides : {};
}

/**
 * The presets a slot's preset-only expansion reads: the slot's own record without its
 * `variant`, which the slot already shows as chosen.
 *
 * @param presets - The level's preset records.
 * @param slotId - The slot.
 * @returns The records, the slot's choice left out.
 */
function presetsAt(presets: InstanceOverrides, slotId: string): InstanceOverrides {
  const record = presets[slotId];
  if (record?.variant === undefined) return presets;
  const rest = Object.fromEntries(Object.entries(record).filter(([field]) => field !== 'variant'));
  const others = Object.fromEntries(Object.entries(presets).filter(([path]) => path !== slotId));
  return Object.keys(rest).length === 0 ? others : { ...others, [slotId]: rest };
}

/** What a level of the walk expands: a main, and the records relative to it. */
type Expanded = Pick<InstanceObject, 'mainId' | 'overrides'>;

/**
 * Appends a main's content under a path prefix: each child top first (as the layers panel lists
 * it), a container's children after it, one level deeper, and a nested instance entered as
 * resolution enters it (`slotExpansion`: its effective main, a swap where it can expand) with
 * that main's content under the longer path, until a path would pass `MAX_INSTANCE_DEPTH` ids
 * (the override path limit, which also ends a reference cycle). Records under a slot for its
 * stored main's children list nothing while it shows another main.
 *
 * @param walk - The board, the overrides and the rows.
 * @param current - The instance being expanded, with its effective records.
 * @param presets - The records its chosen presets alone set, relative to its main: the
 *   same expansion with no own records, a slot's stored records left out.
 * @param prefix - The nested instance ids leading to it.
 * @param ancestorMains - The mains expanded above its main.
 * @param depth - The depth of its children.
 */
function appendMain(
  walk: RowWalk,
  current: Expanded,
  presets: InstanceOverrides,
  prefix: readonly string[],
  ancestorMains: readonly ObjectId[],
  depth: number,
): void {
  const mains = [...ancestorMains, current.mainId];
  const content = new Set(
    definitionContent(walk.board, current.mainId, walk.children).map(({ id }) => id),
  );
  const appendChildren = (parentId: ObjectId, level: number): void => {
    for (const id of sortedSiblings(walk.reader, parentId).reverse()) {
      const stored = walk.reader.get(id);
      if (stored === undefined || !content.has(id)) continue;
      const parts = [...prefix, stored.id];
      const path = parts.join('/');
      const override = Object.hasOwn(walk.overrides, path) ? walk.overrides[path] : undefined;
      const preset = Object.hasOwn(presets, stored.id) ? presets[stored.id] : undefined;
      const fields = editableOverrideFields(stored);
      const shown = {
        path,
        depth: level,
        fields,
        override,
        ...(preset === undefined ? {} : { preset }),
      };
      if (stored.type !== 'instance') {
        walk.rows.push({ ...shown, source: stored });
        appendChildren(stored.id, level + 1);
        continue;
      }
      const slot = slotExpansion(walk.board, stored, current.overrides, mains, walk.children);
      const source = slot.mainId === stored.mainId ? stored : { ...stored, mainId: slot.mainId };
      const placement = { instance: source, storedMainId: stored.mainId, ancestorMains: mains };
      walk.rows.push({ ...shown, source, slot: placement });
      if (parts.length >= MAX_INSTANCE_DEPTH) continue;
      // The presets alone below the slot, at the variant it shows (the own records' choice
      // included): its stored records are its main's content, not a variant's. Under a swap the
      // own records chose, the presets are read through that swap, so the ones carried over to
      // the swapped-in main by layer name show as from the variant, as they draw.
      const bare = { ...stored, variant: slot.variant, overrides: {} };
      const slotPresets = presetsAt(presets, stored.id);
      const presetSlot = slotExpansion(walk.board, bare, slotPresets, mains, walk.children);
      const below =
        presetSlot.mainId === slot.mainId
          ? presetSlot.overrides
          : swappedPresets(walk, bare, slotPresets, slot.mainId, mains, presets);
      appendMain(walk, slot, below, parts, mains, level + 1);
    }
  };
  appendChildren(current.mainId, depth);
}

/**
 * The rows of an instance's inspector (ruling 1): every overridable child of its main,
 * nested instances' children by their nested path up to the depth limit, each with the fields
 * the schema lets it override, the override it has, and what its chosen variant values' presets
 * set there. A nested instance follows its effective main: under a swapped
 * slot the rows are the swapped-in main's children. Reads only the mains' content. Pure.
 *
 * @param board - The document, whole: the main may be on another page.
 * @param instance - The instance.
 * @returns The rows, top first; none when its main cannot be read.
 */
export function instanceOverrideRows(
  board: BoardReader,
  instance: InstanceObject,
): InstanceOverrideRow[] {
  const rows: InstanceOverrideRow[] = [];
  const main = board.get(instance.mainId);
  if (main?.type !== 'component') return rows;
  const closure = closureBoard(board, [instance.mainId, ...namedSwapTargets(instance)]);
  const walk: RowWalk = { reader: board, ...closure, overrides: instance.overrides, rows };
  const current = { ...instance, overrides: effectiveOverridesOf(instance, closure.board) };
  // The presets alone: the composition with no own records on top.
  const presets = effectiveOverrides({ ...instance, overrides: {} }, main);
  appendMain(walk, current, presets, [], [], 0);
  return rows;
}

/**
 * The rows of a main's content against a set of records, as an instance with those records
 * would list them: one of the main's presets edited in the Variants section. Pure.
 *
 * @param board - The document, whole.
 * @param mainId - The main.
 * @param overrides - The records the rows edit.
 * @returns The rows, top first; none when the main cannot be read.
 */
export function mainOverrideRows(
  board: BoardReader,
  mainId: ObjectId,
  overrides: InstanceOverrides,
): InstanceOverrideRow[] {
  const rows: InstanceOverrideRow[] = [];
  if (board.get(mainId)?.type !== 'component') return rows;
  const closure = closureBoard(board, [mainId]);
  const walk: RowWalk = { reader: board, ...closure, overrides, rows };
  appendMain(walk, { mainId, overrides }, {}, [], [], 0);
  return rows;
}
