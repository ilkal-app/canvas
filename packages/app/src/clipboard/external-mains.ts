import { createBoard, importBoard, importBoardInStages, type Board } from '@canvas/schema';

/** A plain record, as JSON parses an object. */
type JsonRecord = Readonly<Record<string, unknown>>;

/**
 * Tells whether a value is a plain record.
 *
 * @param value - The value.
 * @returns Whether it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The mains a document's instances name that the document does not hold: a copy of an instance
 * without its main, whose main stays on the board it was copied from.
 *
 * @param objects - The document's objects, as parsed.
 * @returns Each outside main's id with the first instance naming it.
 */
function outsideMains(objects: readonly unknown[]): Map<string, JsonRecord> {
  const ids = new Set(objects.flatMap((object) => (isRecord(object) ? [object.id] : [])));
  const outside = new Map<string, JsonRecord>();
  for (const object of objects) {
    if (!isRecord(object) || object.type !== 'instance' || typeof object.mainId !== 'string') {
      continue;
    }
    if (!ids.has(object.mainId) && !outside.has(object.mainId)) outside.set(object.mainId, object);
  }
  return outside;
}

/**
 * An empty main standing in for an outside main while the document is checked: at the board
 * root of the instance's page (or of the first root's, for an instance inside a copied frame),
 * with the instance's author and times.
 *
 * @param id - The outside main's id.
 * @param instance - An instance naming it.
 * @param objects - The document's objects, for a root's page.
 * @returns The stand-in, as the portable document lists objects.
 */
function standIn(id: string, instance: JsonRecord, objects: readonly unknown[]): JsonRecord {
  const root = objects.find((object) => isRecord(object) && object.parentId === null);
  const pageId = isRecord(root) ? root.pageId : undefined;
  return {
    id,
    type: 'component',
    parentId: null,
    ...(pageId === undefined ? {} : { pageId }),
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: instance.createdBy,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    name: '',
    retired: false,
  };
}

/**
 * Imports a portable document as `importBoard` does, except that an instance may name a main
 * the document does not hold: a copy of an instance carries the instance alone, its
 * main staying on the board it was copied from, where a paste's `createObjects` finds it (and
 * refuses the paste on a board without it). Each such main is checked against an empty stand-in
 * at the board root, which the returned board leaves out; every other check is `importBoard`'s,
 * an instance naming an object of the document that is not a main included. Pure.
 *
 * @param json - The parsed document, from any source.
 * @returns The board, without the outside mains.
 * @throws {Error} A `BoardImportError` when `importBoard` refuses the document with its stand-ins.
 */
export function importWithExternalMains(json: unknown): Board {
  const { document, outside } = withStandIns(json);
  const board = importBoard(document);
  return outside.size === 0 ? board : withoutStandIns(board, outside);
}

/**
 * {@link importWithExternalMains} in stages (`importBoardInStages`): the same board and
 * the same refusals, `stage` awaited between stages.
 *
 * @param json - The parsed document, from any source.
 * @param stage - Awaited between stages.
 * @returns The board, without the outside mains.
 * @throws {Error} As `importWithExternalMains` throws, or what `stage` rejects with.
 */
export async function importWithExternalMainsInStages(
  json: unknown,
  stage: () => Promise<void>,
): Promise<Board> {
  const { document, outside } = withStandIns(json);
  const board = await importBoardInStages(document, { stage });
  return outside.size === 0 ? board : withoutStandIns(board, outside);
}

/**
 * A document with a stand-in for each outside main its instances name.
 *
 * @param json - The parsed document.
 * @returns The document to import (the input itself when it names none) and the outside mains.
 */
function withStandIns(json: unknown): {
  readonly document: unknown;
  readonly outside: ReadonlyMap<string, JsonRecord>;
} {
  const objects: readonly unknown[] | undefined =
    isRecord(json) && Array.isArray(json.objects) ? (json.objects as unknown[]) : undefined;
  const outside = objects === undefined ? new Map<string, JsonRecord>() : outsideMains(objects);
  if (objects === undefined || outside.size === 0) return { document: json, outside };
  const standIns = [...outside].map(([id, instance]) => standIn(id, instance, objects));
  return { document: { ...(json as JsonRecord), objects: [...objects, ...standIns] }, outside };
}

/**
 * An imported board without the stand-ins of its outside mains.
 *
 * @param board - The board imported with them.
 * @param outside - The outside mains.
 * @returns The board without them.
 */
function withoutStandIns(board: Board, outside: ReadonlyMap<string, JsonRecord>): Board {
  const kept = [...board.objects.values()].filter(({ id }) => !outside.has(id));
  return createBoard(kept, board.pages?.values());
}
