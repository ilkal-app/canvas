import { generateNKeysBetween } from '@canvas/document';
import type {
  BoardObject,
  FrameObject,
  ObjectId,
  PrincipalId,
  Rgba,
  ShapeObject,
} from '@canvas/schema';

/**
 * The demo board's geometry, world units: a 2 × 2 grid of frames ("sections"), each holding
 * 10 × 7 filled rectangles, one per 90 × 80 cell, inset by 10. 284 objects in all. The scenario
 * tests (`tooling/scenario/specs/tools/__fixtures__/demo-board.ts`) and the golden scene
 * `camera-fit` mirror these numbers; change them together.
 */
export const DEMO_BOARD_LAYOUT = {
  /** The top-left corner of the first section. */
  origin: { x: 40, y: 40 },
  /** Sections across and down. */
  sections: { columns: 2, rows: 2 },
  /** The space between sections. */
  sectionGap: 60,
  /** Rectangles across and down in a section. */
  cells: { columns: 10, rows: 7 },
  /** One cell's size. */
  cell: { width: 90, height: 80 },
  /** A rectangle's offset inside its cell, and its size. */
  rect: { inset: 10, width: 70, height: 60 },
} as const;

/**
 * Fills of the rectangles, cycled by position. Each channel is a whole number over 255, so the
 * colour survives the GPU's 8-bit output exactly and pixel tests can compare it.
 */
const RECT_FILLS: readonly Rgba[] = [
  [230, 57, 70, 255],
  [42, 157, 143, 255],
  [233, 196, 106, 255],
  [69, 123, 157, 255],
  [244, 162, 97, 255],
  [131, 56, 236, 255],
  [38, 70, 83, 255],
].map((rgba) => rgba.map((channel) => channel / 255) as unknown as Rgba);

/** Section backgrounds, light tints, again in whole 8-bit steps. */
const SECTION_BACKGROUNDS: readonly Rgba[] = [
  [241, 243, 245, 255],
  [236, 246, 240, 255],
  [246, 240, 232, 255],
  [238, 238, 250, 255],
].map((rgba) => rgba.map((channel) => channel / 255) as unknown as Rgba);

/** A fixed time for every demo object, so the board is the same on every load. */
const CREATED_AT_MS = 1_767_225_600_000;

function sharedFields(id: string, parentId: string | null, x: number, y: number) {
  return {
    id: id as ObjectId,
    parentId: parentId as ObjectId | null,
    x,
    y,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:demo' as PrincipalId,
    createdAt: CREATED_AT_MS,
    updatedAt: CREATED_AT_MS,
  };
}

function pick<TValue>(values: readonly TValue[], index: number): TValue {
  const value = values[index % values.length];
  if (value === undefined) throw new RangeError('A demo palette is empty.');
  return value;
}

function createSection(sectionIndex: number, column: number, row: number): BoardObject[] {
  const { origin, sectionGap, cells, cell, rect } = DEMO_BOARD_LAYOUT;
  const sectionId = `section-${String(sectionIndex)}`;
  const width = cells.columns * cell.width;
  const height = cells.rows * cell.height;
  const frame: FrameObject = {
    ...sharedFields(
      sectionId,
      null,
      origin.x + column * (width + sectionGap),
      origin.y + row * (height + sectionGap),
    ),
    type: 'frame',
    width,
    height,
    name: `Section ${String(sectionIndex + 1)}`,
    clip: false,
    background: pick(SECTION_BACKGROUNDS, sectionIndex),
  };
  const rects: ShapeObject[] = [];
  for (let cellRow = 0; cellRow < cells.rows; cellRow += 1) {
    for (let cellColumn = 0; cellColumn < cells.columns; cellColumn += 1) {
      rects.push({
        ...sharedFields(
          `${sectionId}-rect-${String(cellColumn)}-${String(cellRow)}`,
          sectionId,
          cellColumn * cell.width + rect.inset,
          cellRow * cell.height + rect.inset,
        ),
        type: 'shape',
        kind: 'rectangle',
        width: rect.width,
        height: rect.height,
        stroke: null,
        fill: pick(RECT_FILLS, cellColumn + 2 * cellRow + 3 * sectionIndex),
        cornerRadius: 0,
        sides: 4,
        label: null,
      });
    }
  }
  return [frame, ...rects];
}

/**
 * Builds the board the app shows until it is connected to a document: a few hundred
 * rectangles in four sections, so there is something to pan and zoom over and to test the
 * camera against. Deterministic: the same objects, ids, colours and z keys on every call.
 * Siblings have distinct z keys, ordered as they are created, so the board loads as
 * `createObject` would stack it and every order command works on it, whoever loads it as it is
 * (the engine harness, the benchmark boards). Sticky notes join once the scene graph draws them
 * (the SDF shape pass, and sticky notes).
 *
 * @returns The objects, each section's frame before its rectangles.
 */
export function createDemoBoard(): BoardObject[] {
  const { columns, rows } = DEMO_BOARD_LAYOUT.sections;
  const objects: BoardObject[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      objects.push(...createSection(row * columns + column, column, row));
    }
  }
  return withSiblingKeys(objects);
}

/**
 * Gives each parent's children distinct z keys in the order they are listed, bottom to top,
 * from the document's key generator.
 *
 * @param objects - The objects, in creation order.
 * @returns New objects with their keys; the input is not changed.
 */
function withSiblingKeys(objects: readonly BoardObject[]): BoardObject[] {
  const siblings = new Map<ObjectId | null, number>();
  for (const { parentId } of objects) siblings.set(parentId, (siblings.get(parentId) ?? 0) + 1);
  const keys = new Map(
    [...siblings].map(([parentId, count]) => [parentId, generateNKeysBetween(null, null, count)]),
  );
  const used = new Map<ObjectId | null, number>();
  return objects.map((object) => {
    const index = used.get(object.parentId) ?? 0;
    used.set(object.parentId, index + 1);
    return { ...object, z: keys.get(object.parentId)?.[index] ?? object.z };
  });
}
