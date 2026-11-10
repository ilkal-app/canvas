// The realistic design board (P6): the owner's Canvas redesign
// (`design-parts.ts`) tiled to a 50k-object board. One library copy keeps its ids, so every
// instance's main resolves; each tile copies the three screens with fresh ids into a section
// frame; nine sections make a page-like frame; annotation texts in a notes frame make up the
// count. The tile nearest the board's middle is centred on the origin, where the scenarios sweep,
// drag and move collaborators. Every bench board before it was generated from rectangles.
import {
  createSeededIdGenerator,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import {
  DESIGN_BOARD_SEED,
  designParts,
  holderFrame,
  NOTE_CELL,
  NOTE_COLUMNS,
  PAGE_COLUMNS,
  PAGE_GAP,
  remapped,
  SCREEN_GAP,
  SECTION_GAP,
  SECTIONS_PER_SIDE,
  sectionSize,
  sizeOf,
  zKey,
  type DesignParts,
} from './design-parts.js';

/** A page-like frame's fill: a light canvas grey, opaque. */
const PAGE_FILL: [number, number, number, number] = [0.96, 0.96, 0.97, 1];

/** How many tiles, pages and annotations make up a target count. */
interface DesignPlan {
  readonly tiles: number;
  readonly pages: number;
  readonly notes: number;
}

/**
 * The most whole tiles that fit a target count, with their sections, pages and the notes frame;
 * annotation texts make up the rest. Pure.
 *
 * @param parts - The fixture's library and screens.
 * @param target - The object count wanted.
 * @returns The plan.
 * @throws {Error} When the target is smaller than the library and one tile.
 */
function planDesign(parts: DesignParts, target: number): DesignPlan {
  const perTile = parts.screens.reduce((sum, screen) => sum + screen.length, 0) + 1;
  const pagesOf = (tiles: number): number => Math.ceil(tiles / SECTIONS_PER_SIDE ** 2);
  const fixed = parts.library.length + 1;
  let tiles = Math.floor((target - fixed) / perTile);
  while (tiles > 0 && fixed + tiles * perTile + pagesOf(tiles) > target) tiles -= 1;
  if (tiles < 1) throw new Error(`A design board needs more than ${String(target)} objects.`);
  const notes = target - fixed - tiles * perTile - pagesOf(tiles);
  return { tiles, pages: pagesOf(tiles), notes };
}

/** A box in world units. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Copies one screen into a section with fresh ids, every reference to a copied object remapped
 * and references to the library kept.
 *
 * @param screen - The screen's subtree, its root first.
 * @param nextId - The id generator.
 * @param placement - Its section, x and z key there.
 * @param placement.sectionId - The section.
 * @param placement.x - Its x in the section.
 * @param placement.z - Its z key among the section's screens.
 * @returns The copy, parents before children.
 */
function copyScreen(
  screen: readonly BoardObject[],
  nextId: () => ObjectId,
  placement: { sectionId: ObjectId; x: number; z: string },
): BoardObject[] {
  const ids = new Map<string, ObjectId>(screen.map(({ id }) => [id, nextId()]));
  return screen.map((object, index) => {
    const copy = remapped(object, ids) as BoardObject;
    if (index > 0) return { ...copy, pageId: null };
    const root = { parentId: placement.sectionId, pageId: null, x: placement.x, y: SCREEN_GAP };
    return { ...copy, ...root, z: placement.z };
  });
}

/**
 * The pages, their sections and the screen copies, laid on the board's page grid.
 *
 * @param parts - The fixture's screens.
 * @param plan - How many tiles and pages.
 * @param nextId - The id generator.
 * @returns The objects and each section's world box.
 */
function tiledPages(
  parts: DesignParts,
  plan: DesignPlan,
  nextId: () => ObjectId,
): { objects: BoardObject[]; sections: Box[]; page: Box } {
  const section = sectionSize(parts.screens);
  const side = SECTIONS_PER_SIDE;
  const page = {
    x: 0,
    y: 0,
    width: side * section.width + (side + 1) * SECTION_GAP,
    height: side * section.height + (side + 1) * SECTION_GAP,
  };
  const objects: BoardObject[] = [];
  const sections: Box[] = [];
  for (let pageIndex = 0; pageIndex < plan.pages; pageIndex += 1) {
    const pageId = nextId();
    const pageX = (pageIndex % PAGE_COLUMNS) * (page.width + PAGE_GAP);
    const pageY = Math.floor(pageIndex / PAGE_COLUMNS) * (page.height + PAGE_GAP);
    const box = { ...page, x: pageX, y: pageY };
    const name = `Page ${String(pageIndex + 1)}`;
    objects.push(
      holderFrame({
        id: pageId,
        parentId: null,
        box,
        z: zKey(pageIndex),
        name,
        background: PAGE_FILL,
      }),
    );
    for (let slot = 0; slot < side ** 2; slot += 1) {
      const tile = pageIndex * side ** 2 + slot;
      if (tile >= plan.tiles) break;
      const sectionId = nextId();
      const x = SECTION_GAP + (slot % side) * (section.width + SECTION_GAP);
      const y = SECTION_GAP + Math.floor(slot / side) * (section.height + SECTION_GAP);
      const sectionName = `Section ${String(tile + 1)}`;
      objects.push(
        holderFrame({
          id: sectionId,
          parentId: pageId,
          box: { x, y, ...section },
          z: zKey(slot),
          name: sectionName,
          background: null,
        }),
      );
      sections.push({ x: pageX + x, y: pageY + y, ...section });
      let screenX = SCREEN_GAP;
      for (const [index, screen] of parts.screens.entries()) {
        objects.push(...copyScreen(screen, nextId, { sectionId, x: screenX, z: zKey(index) }));
        screenX += sizeOf(screen[0]).width + SCREEN_GAP;
      }
    }
  }
  return { objects, sections, page };
}

/**
 * The notes frame below the pages: `count` annotation texts in the screens' body style.
 *
 * @param parts - The fixture's note style.
 * @param count - How many annotations.
 * @param origin - The frame's top left, world units.
 * @param origin.x - Its left, world units.
 * @param origin.y - Its top, world units.
 * @param nextId - The id generator.
 * @returns The frame and its texts, parents first.
 */
function notesFrame(
  parts: DesignParts,
  count: number,
  origin: { x: number; y: number },
  nextId: () => ObjectId,
): BoardObject[] {
  const notesId = nextId();
  const rows = Math.max(1, Math.ceil(count / NOTE_COLUMNS));
  const box = { ...origin, width: NOTE_COLUMNS * NOTE_CELL.width, height: rows * NOTE_CELL.height };
  const frame = holderFrame({
    id: notesId,
    parentId: null,
    box,
    z: zKey(999),
    name: 'Notes',
    background: null,
  });
  const texts = [...Array(count).keys()].map((index): BoardObject => {
    const text = `Note ${String(index + 1)}: check spacing and contrast`;
    return {
      id: nextId(),
      type: 'text',
      parentId: notesId,
      pageId: null,
      x: (index % NOTE_COLUMNS) * NOTE_CELL.width,
      y: Math.floor(index / NOTE_COLUMNS) * NOTE_CELL.height,
      width: NOTE_CELL.width - 20,
      height: NOTE_CELL.height - 20,
      rotation: 0,
      z: zKey(index % 1_000),
      locked: false,
      createdBy: 'user:bench',
      createdAt: 1_760_000_000_000,
      updatedAt: 1_760_000_000_000,
      text,
      runs: [{ length: text.length, style: parts.noteStyle }],
      align: 'left',
      verticalAlign: 'top',
      autoWidth: false,
    } as unknown as BoardObject;
  });
  return [frame, ...texts];
}

/**
 * The objects moved by an offset: the roots alone, as children sit in their parents' frames.
 *
 * @param objects - The objects.
 * @param dx - The x offset, world units.
 * @param dy - The y offset, world units.
 * @returns The moved objects; the inputs are not changed.
 */
function shifted(objects: readonly BoardObject[], dx: number, dy: number): BoardObject[] {
  return objects.map((object) =>
    object.parentId === null ? { ...object, x: object.x + dx, y: object.y + dy } : object,
  );
}

/** The design board's objects and its page grid. */
export interface DesignBoardLayout {
  /** The objects, parents before children. */
  readonly objects: BoardObject[];
  /** The pages' grid: columns and rows. */
  readonly grid: {
    /** Pages across. */
    readonly columns: number;
    /** Pages down. */
    readonly rows: number;
  };
}

/**
 * The realistic design board: the fixture's library once, as many whole tiles of its
 * three screens as fit `targetObjects`, nine sections a page, and annotation texts making up the
 * count exactly. The library sits left of the pages and the notes below them; the tile nearest
 * the pages' middle is centred on the origin. Pure and deterministic: the same fixture and target
 * give the same board, with seeded ids.
 *
 * @param fixture - The design fixture (packages/app/assets/bench/design-v1.json), imported.
 * @param targetObjects - The object count.
 * @returns The objects and the pages' grid.
 * @throws {Error} When the target is smaller than the library and one tile.
 */
export function designBoardLayout(fixture: Board, targetObjects: number): DesignBoardLayout {
  const parts = designParts(fixture);
  const plan = planDesign(parts, targetObjects);
  const nextId = createSeededIdGenerator(DESIGN_BOARD_SEED);
  const { objects: pages, sections, page } = tiledPages(parts, plan, nextId);
  const rows = Math.ceil(plan.pages / PAGE_COLUMNS);
  const columns = Math.min(plan.pages, PAGE_COLUMNS);
  const pagesWidth = columns * page.width + (columns - 1) * PAGE_GAP;
  const pagesHeight = rows * page.height + (rows - 1) * PAGE_GAP;
  const libraryRoots = parts.library.filter(({ parentId }) => parentId === null);
  const libraryLeft = Math.min(...libraryRoots.map(({ x }) => x));
  const libraryTop = Math.min(...libraryRoots.map(({ y }) => y));
  const libraryRight = Math.max(...libraryRoots.map((root) => root.x + sizeOf(root).width));
  const library = shifted(
    parts.library,
    -PAGE_GAP - (libraryRight - libraryLeft) - libraryLeft,
    -libraryTop,
  );
  const notes = notesFrame(parts, plan.notes, { x: 0, y: pagesHeight + PAGE_GAP }, nextId);
  const middle = { x: pagesWidth / 2, y: pagesHeight / 2 };
  const centre = sections
    .map((box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }))
    .reduce((best, point) =>
      Math.hypot(point.x - middle.x, point.y - middle.y) <
      Math.hypot(best.x - middle.x, best.y - middle.y)
        ? point
        : best,
    );
  const objects = shifted([...library, ...pages, ...notes], -centre.x, -centre.y);
  return { objects, grid: { columns, rows } };
}

/**
 * The realistic design board's objects (`designBoardLayout`), for the nightly bench and the app's
 * /bench page alike. Pure.
 *
 * @param fixture - The design fixture, imported.
 * @param targetObjects - The object count.
 * @returns The objects, parents before children.
 * @throws {Error} When the target is smaller than the library and one tile.
 */
export function designBoardObjects(fixture: Board, targetObjects: number): BoardObject[] {
  return designBoardLayout(fixture, targetObjects).objects;
}
