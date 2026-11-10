// The realistic design board's pieces: the owner's Canvas redesign, frozen
// in packages/app/assets/bench/design-v1.json from the MX-bench v1 inputs, split into what the
// tiler (`design-board.ts`) copies. Moved from tooling/bench so the app's /bench page and the
// nightly tile the same board. Pure.
import type { Board, BoardObject, ObjectId } from '@canvas/schema';

/** The library's page in the fixture; the screens are each on a page of their own. */
const LIBRARY_PAGE = 'page-1';

/** The seed of the copies' ids. */
export const DESIGN_BOARD_SEED = 551;

/** Gaps between screens in a section and around them, world units. */
export const SCREEN_GAP = 80;

/** Gap between sections in a page and around them, world units. */
export const SECTION_GAP = 200;

/** Sections per page, as a square grid's side: 3 × 3. */
export const SECTIONS_PER_SIDE = 3;

/** Pages per row of the board. */
export const PAGE_COLUMNS = 4;

/** Gap between pages, world units. */
export const PAGE_GAP = 1_000;

/** An annotation text's cell in the notes frame, world units. */
export const NOTE_CELL = { width: 260, height: 60 };

/** Annotations per row of the notes frame. */
export const NOTE_COLUMNS = 20;

/**
 * Each object and its subtree, parents before children, from a root.
 *
 * @param root - The root.
 * @param children - Children by parent id, in board order.
 * @returns The subtree.
 */
function subtreeOf(
  root: BoardObject,
  children: ReadonlyMap<ObjectId, readonly BoardObject[]>,
): BoardObject[] {
  const out: BoardObject[] = [];
  const pending = [root];
  for (let object = pending.shift(); object !== undefined; object = pending.shift()) {
    out.push(object);
    pending.push(...(children.get(object.id) ?? []));
  }
  return out;
}

/**
 * A string naming a copied object as its copy's id: an id, or a path of ids through nested
 * instances (an override key, `outer/inner`), each segment remapped.
 *
 * @param value - The string.
 * @param ids - Old id to new.
 * @returns The string, remapped.
 */
function remappedString(value: string, ids: ReadonlyMap<string, ObjectId>): string {
  const direct = ids.get(value);
  if (direct !== undefined) return direct;
  if (!value.includes('/')) return value;
  const segments = value.split('/');
  if (!segments.some((segment) => ids.has(segment))) return value;
  return segments.map((segment) => ids.get(segment) ?? segment).join('/');
}

/**
 * A value with every string that names a copied object replaced by its copy's id, keys included.
 *
 * @param value - The value.
 * @param ids - Old id to new.
 * @returns The value, remapped; the input is not changed.
 */
export function remapped(value: unknown, ids: ReadonlyMap<string, ObjectId>): unknown {
  if (typeof value === 'string') return remappedString(value, ids);
  if (Array.isArray(value)) return value.map((item) => remapped(item, ids));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [remappedString(key, ids), remapped(item, ids)]),
  );
}

/**
 * A frame holding a part of the board: a section of screens, a page of sections, the notes.
 *
 * @param fields - Its id, parent, box, z key and name.
 * @param fields.id - Its id.
 * @param fields.parentId - Its parent, or null for a root.
 * @param fields.box - Its box in its parent, world units.
 * @param fields.box.x - Its x.
 * @param fields.box.y - Its y.
 * @param fields.box.width - Its width.
 * @param fields.box.height - Its height.
 * @param fields.z - Its z key.
 * @param fields.name - Its name.
 * @param fields.background - Its fill, or null.
 * @returns The frame.
 */
export function holderFrame(fields: {
  id: ObjectId;
  parentId: ObjectId | null;
  box: { x: number; y: number; width: number; height: number };
  z: string;
  name: string;
  background: [number, number, number, number] | null;
}): BoardObject {
  return {
    id: fields.id,
    type: 'frame',
    parentId: fields.parentId,
    pageId: null,
    ...fields.box,
    rotation: 0,
    z: fields.z,
    locked: false,
    createdBy: 'user:bench',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    name: fields.name,
    clip: false,
    background: fields.background,
  } as unknown as BoardObject;
}

/**
 * A z key among up to 1,000 siblings, after every key the fixture's roots use (`a…`).
 *
 * @param index - The sibling's place, 0 to 999.
 * @returns The key: `c` and three digits, a fractional index.
 */
export function zKey(index: number): string {
  return `c${String(index).padStart(3, '0')}`;
}

/** The fixture split into its library and its three screens. */
export interface DesignParts {
  readonly library: readonly BoardObject[];
  readonly screens: readonly (readonly BoardObject[])[];
  readonly noteStyle: unknown;
}

/**
 * Splits the fixture into the library (the objects of its first page) and each screen's subtree.
 *
 * @param board - The fixture.
 * @returns The parts.
 * @throws {Error} When the fixture has no screen or no text.
 */
export function designParts(board: Board): DesignParts {
  const objects = [...board.objects.values()];
  const children = new Map<ObjectId, BoardObject[]>();
  for (const object of objects) {
    if (object.parentId === null) continue;
    children.set(object.parentId, [...(children.get(object.parentId) ?? []), object]);
  }
  const roots = objects.filter(({ parentId }) => parentId === null);
  const library = roots
    .filter(({ pageId }) => pageId === LIBRARY_PAGE)
    .flatMap((root) => subtreeOf(root, children))
    .map((object) => ({ ...object, pageId: null }));
  const screens = roots
    .filter(({ pageId }) => pageId !== LIBRARY_PAGE)
    .map((root) => subtreeOf(root, children));
  const text = screens.flat().find((object) => object.type === 'text');
  if (screens.length === 0 || text?.type !== 'text') {
    throw new Error('The design fixture has no screen with text.');
  }
  return { library, screens, noteStyle: text.runs[0]?.style };
}

/**
 * An object's box size; zero for one without a box (a line, a connector).
 *
 * @param object - The object.
 * @returns Its width and height, world units.
 */
export function sizeOf(object: BoardObject | undefined): { width: number; height: number } {
  if (object === undefined || !('width' in object)) return { width: 0, height: 0 };
  return { width: object.width, height: object.height };
}

/**
 * One tile's size: a section of the three screens side by side.
 *
 * @param screens - Each screen's subtree, its root first.
 * @returns The section's width and height, world units.
 */
export function sectionSize(screens: readonly (readonly BoardObject[])[]): {
  width: number;
  height: number;
} {
  const roots = screens.map(([root]) => root);
  return {
    width: roots.reduce((sum, root) => sum + sizeOf(root).width + SCREEN_GAP, SCREEN_GAP),
    height: Math.max(...roots.map((root) => sizeOf(root).height)) + 2 * SCREEN_GAP,
  };
}
