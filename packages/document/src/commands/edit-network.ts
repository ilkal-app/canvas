import { z } from 'zod';

import {
  objectIdSchema,
  pathDataToNetwork,
  segmentSchema,
  vertexSchema,
  type BoardObjectOf,
  type ObjectId,
  type Segment,
  type Vertex,
} from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';

/** Validates a vertex or segment id as the edit names it: 1 to 64 characters. */
const memberIdSchema = z.string().min(1).max(64);

/** Validates the input of {@link editNetworkCommand}. */
export const editNetworkInputSchema = z
  .strictObject({
    /** The path whose network changes. */
    id: objectIdSchema.describe('The path whose vector network changes.'),
    /** Vertices to add, or to replace whole by id. */
    setVertices: z
      .array(vertexSchema)
      .optional()
      .describe('Vertices to add, or to replace whole by id.'),
    /** Ids of vertices to delete; the segments ending at them must be deleted too. */
    deleteVertexIds: z
      .array(memberIdSchema)
      .optional()
      .describe('Ids of vertices to delete; delete the segments ending at them too.'),
    /** Segments to add, or to replace whole by id. */
    setSegments: z
      .array(segmentSchema)
      .optional()
      .describe('Segments to add, or to replace whole by id.'),
    /** Ids of segments to delete. */
    deleteSegmentIds: z.array(memberIdSchema).optional().describe('Ids of segments to delete.'),
    /** The whole network as SVG path data, in the path's own frame. */
    d: z
      .string()
      .optional()
      .describe(
        "The whole network as SVG path data in the path's own frame (x/y unchanged), replacing every vertex and segment; give it alone, without the lists.",
      ),
  })
  .describe(
    "Edits a path's vector network member by member (vertices and segments set or deleted by id), or replaces it whole with SVG path data.",
  );

/** The parsed input of {@link editNetworkCommand}. */
export type EditNetworkInput = z.output<typeof editNetworkInputSchema>;

/** The edit's four lists, each given or empty. */
interface MemberLists {
  readonly setVertices: readonly Vertex[];
  readonly deleteVertexIds: readonly string[];
  readonly setSegments: readonly Segment[];
  readonly deleteSegmentIds: readonly string[];
}

/** The edit's lists, by name: what `d` may not be given with. */
const MEMBER_LISTS = ['setVertices', 'deleteVertexIds', 'setSegments', 'deleteSegmentIds'] as const;

/**
 * The edit's four lists, an omitted one empty.
 *
 * @param input - The edit.
 * @returns The lists.
 */
function listsOf(input: EditNetworkInput): MemberLists {
  return {
    setVertices: input.setVertices ?? [],
    deleteVertexIds: input.deleteVertexIds ?? [],
    setSegments: input.setSegments ?? [],
    deleteSegmentIds: input.deleteSegmentIds ?? [],
  };
}

/** What {@link editNetworkCommand} writes: the path's network after the edit. */
export interface EditNetworkPlan {
  /** The path. */
  readonly id: ObjectId;
  /** Its vertices after the edit, in stored order, new ones appended in input order. */
  readonly vertices: readonly Vertex[];
  /** Its segments after the edit, likewise. */
  readonly segments: readonly Segment[];
}

/** What {@link editNetworkCommand} returns. */
export interface EditNetworkResult {
  /** The path edited. */
  readonly id: ObjectId;
}

/** A member of a list `editMembers` edits: anything with an id (a vertex, a segment). */
export interface NetworkMember {
  /** The member's id, unique in its list. */
  readonly id: string;
}

/** The `editNetwork` command's type. */
export type EditNetworkCommand = Command<
  typeof editNetworkInputSchema,
  EditNetworkPlan,
  EditNetworkResult
>;

/** One list of the edit, as its input path names it. */
type MemberList = 'setVertices' | 'deleteVertexIds' | 'setSegments' | 'deleteSegmentIds';

/**
 * Reports ids listed twice in one list of the edit, or in both the set and the delete list of
 * the same kind of member.
 *
 * @param input - The edit.
 * @param pathId - The path's id, for the errors.
 * @returns The problems.
 */
function listErrors(input: MemberLists, pathId: ObjectId): CommandError[] {
  const errors: CommandError[] = [];
  const pairs: readonly [MemberList, MemberList, readonly string[], readonly string[]][] = [
    [
      'setVertices',
      'deleteVertexIds',
      input.setVertices.map(({ id }) => id),
      input.deleteVertexIds,
    ],
    [
      'setSegments',
      'deleteSegmentIds',
      input.setSegments.map(({ id }) => id),
      input.deleteSegmentIds,
    ],
  ];
  for (const [setList, deleteList, setIds, deleteIds] of pairs) {
    const seen = new Set<string>();
    const lists: readonly [MemberList, readonly string[]][] = [
      [setList, setIds],
      [deleteList, deleteIds],
    ];
    for (const [list, ids] of lists) {
      ids.forEach((memberId, index) => {
        if (seen.has(memberId)) {
          const message = `"${memberId}" is listed more than once in the edit`;
          errors.push(commandError('invalid-input', pathId, [list, index], message));
        }
        seen.add(memberId);
      });
    }
  }
  return errors;
}

/**
 * Reports deletions of members the network does not hold: the edit was made against another
 * state of the network, so it is refused rather than half applied.
 *
 * @param path - The path.
 * @param input - The edit.
 * @returns The problems.
 */
function missingMemberErrors(path: BoardObjectOf<'path'>, input: MemberLists): CommandError[] {
  const errors: CommandError[] = [];
  const checks: readonly [MemberList, readonly string[], ReadonlySet<string>, string][] = [
    [
      'deleteVertexIds',
      input.deleteVertexIds,
      new Set(path.vertices.map(({ id }) => id)),
      'vertex',
    ],
    [
      'deleteSegmentIds',
      input.deleteSegmentIds,
      new Set(path.segments.map(({ id }) => id)),
      'segment',
    ],
  ];
  for (const [list, ids, held, kind] of checks) {
    ids.forEach((memberId, index) => {
      if (held.has(memberId)) return;
      const message = `the path has no ${kind} "${memberId}"`;
      errors.push(commandError('invalid-input', path.id, [list, index], message));
    });
  }
  return errors;
}

/**
 * Reports new vertices the edit leaves joined to no segment in a network that has one: a read
 * leaves such a vertex out (`codec/network-visibility.ts`), so adding one alone would write a
 * vertex nobody sees. A vertex is added with the segment that joins it.
 *
 * @param path - The path before the edit.
 * @param input - The edit.
 * @param segments - The segments after the edit.
 * @returns The problems.
 */
function strayVertexErrors(
  path: BoardObjectOf<'path'>,
  input: MemberLists,
  segments: readonly Segment[],
): CommandError[] {
  if (segments.length === 0) return [];
  const held = new Set(path.vertices.map(({ id }) => id));
  const joined = new Set(segments.flatMap(({ a, b }) => [a, b]));
  const errors: CommandError[] = [];
  input.setVertices.forEach(({ id }, index) => {
    if (held.has(id) || joined.has(id)) return;
    const message = `the new vertex "${id}" joins no segment: add it with the segment that joins it`;
    errors.push(commandError('invalid-input', path.id, ['setVertices', index], message));
  });
  return errors;
}

/**
 * The vertices an edit keeps: once the network has a segment, only those a segment joins. A
 * vertex the edit leaves joined to nothing is deleted with the edit (a read would leave it out,
 * `codec/network-visibility.ts`, and a new one alone is refused), so it is not left stored.
 *
 * @param vertices - The vertices after the edit's own deletes and sets.
 * @param segments - The segments after the edit.
 * @returns The vertices to write.
 */
function joinedVertices(vertices: readonly Vertex[], segments: readonly Segment[]): Vertex[] {
  if (segments.length === 0) return [...vertices];
  const joined = new Set(segments.flatMap(({ a, b }) => [a, b]));
  return vertices.filter(({ id }) => joined.has(id));
}

/**
 * Applies deletions and replacements by id to a list of members: deleted members leave, set
 * members replace the member with their id in its place, and new members are appended in the
 * order given. Pure; neither list is changed.
 *
 * @param members - The members now.
 * @param deleted - The ids to delete.
 * @param set - The members to add or replace.
 * @returns The members after the edit.
 */
export function editMembers<Member extends NetworkMember>(
  members: readonly Member[],
  deleted: readonly string[],
  set: readonly Member[],
): Member[] {
  const gone = new Set(deleted);
  const replacements = new Map(set.map((member) => [member.id, member]));
  const kept = members
    .filter(({ id }) => !gone.has(id))
    .map((member) => replacements.get(member.id) ?? member);
  const held = new Set(members.map(({ id }) => id));
  return [...kept, ...set.filter(({ id }) => !held.has(id))];
}

/** How many characters of a fresh object id prefix a replacement's member ids. */
const MEMBER_PREFIX_LENGTH = 16;

/**
 * Renames a new network's members under a prefix from a fresh object id, so none takes an id the
 * path's stored network holds, read or hidden (a merge can leave members a read leaves out,
 * `codec/network-visibility.ts`): a hidden member is never overwritten and brought back, and a
 * peer's concurrent edit of an old member never lands on a new one.
 *
 * @param network - The new network, ids `v0…` and `s0…`.
 * @param network.vertices - Its vertices.
 * @param network.segments - Its segments.
 * @param createId - The command's id generator.
 * @returns The network with fresh ids, `<prefix>-v0…` and `<prefix>-s0…`.
 */
function withFreshIds(
  network: { readonly vertices: readonly Vertex[]; readonly segments: readonly Segment[] },
  createId: () => string,
): { vertices: Vertex[]; segments: Segment[] } {
  const prefix = createId().slice(0, MEMBER_PREFIX_LENGTH);
  const named = (id: string): string => `${prefix}-${id}`;
  return {
    vertices: network.vertices.map((vertex) => ({ ...vertex, id: named(vertex.id) })),
    segments: network.segments.map((segment) => ({
      ...segment,
      id: named(segment.id),
      a: named(segment.a),
      b: named(segment.b),
    })),
  };
}

/**
 * Validates an edit that replaces a path's whole network with SVG path data: read in
 * the path's own frame as written, each open subpath left open (`pathDataToNetwork`), refused
 * with a list beside it, then checked as the store will write it.
 *
 * @param context - The command's context.
 * @param context.board - The board.
 * @param path - The path.
 * @param data - The path data.
 * @param input - The edit, for the lists given with it.
 * @returns The plan, or the problems.
 */
function replaceNetwork(
  context: Parameters<EditNetworkCommand['validate']>[0],
  path: BoardObjectOf<'path'>,
  data: string,
  input: EditNetworkInput,
): ReturnType<EditNetworkCommand['validate']> {
  const given = MEMBER_LISTS.filter((list) => input[list] !== undefined);
  if (given.length > 0) {
    const message = `d replaces the whole network: give it without ${given.join(', ')}`;
    return reject([commandError('invalid-input', path.id, ['d'], message)]);
  }
  const read = pathDataToNetwork(data, { isFilled: path.fill !== null });
  if (!read.isRead) return reject([commandError('invalid-input', path.id, ['d'], read.problem)]);
  const errors: CommandError[] = [];
  const network = withFreshIds(read, context.createId);
  const checked = checkObject(context.board, { ...path, ...network }, errors);
  if (checked?.type !== 'path') return reject(errors);
  return accept({ id: path.id, vertices: checked.vertices, segments: checked.segments });
}

/**
 * `editNetwork`: edits a path's
 * vector network member by member, the one command every pen and vector-edit gesture writes.
 * `validate` looks the path up (a missing object, another type or a locked path is refused, as
 * a move of a locked object is), refuses an id listed twice or both set and deleted, and a
 * deletion of a member the network does not hold, then computes the network after the edit and
 * checks it as the store will write it (`checkObject`): only the members the edit
 * changes are parsed, and only the network rules they take part in are checked (`findNetworkIssues`'
 * rules: a changed member's id, its ends, a pair joined twice, and a vertex deleted while a
 * segment still ends at it), so a member a peer left invalid does not block an edit of another;
 * it also refuses a new
 * vertex that joins no segment in a network that has one (a read would leave it out); a vertex
 * the edit leaves joined to nothing, in a network that keeps a segment, is deleted with the
 * edit. `apply` patches the two network fields, which the store brings to the new members by
 * id: only the members the edit sets or deletes are written, each its own entry of the
 * network's keyed map, so a concurrent edit of other vertices or segments merges and two edits
 * of one member keep one whole. A merge can still leave a segment ending at a vertex another
 * client deleted, two segments joining one pair, or a vertex with no segment: a read of the path
 * leaves those out (`codec/network-visibility.ts`) and the document keeps them, so an undo or a
 * late update that brings the vertex back makes the segment whole again. The write deletes, in
 * the same transaction (one undo step), those it makes unable to come back: stored segments
 * ending at a vertex it deletes or at a vertex id it creates, and stored duplicates of a shown
 * segment it deletes (`codec/network-collection.ts`).
 */
export const editNetworkCommand: EditNetworkCommand = {
  name: 'editNetwork',
  description:
    "Edits a path's vector network: sets (adds or replaces) and deletes vertices and segments by id, or replaces it whole with d, SVG path data in the path's own frame (its x and y unchanged).",
  input: editNetworkInputSchema,
  validate(context, input) {
    const object = context.board.get(input.id);
    if (object === undefined) {
      return reject([
        commandError('missing-object', input.id, ['id'], `there is no object "${input.id}"`),
      ]);
    }
    if (object.type !== 'path') {
      const message = `"${input.id}" is a ${object.type}; only a path has a vector network`;
      return reject([commandError('unsupported-type', input.id, ['id'], message)]);
    }
    if (object.locked) {
      return reject([commandError('locked', input.id, ['id'], `"${input.id}" is locked`)]);
    }
    if (input.d !== undefined) return replaceNetwork(context, object, input.d, input);
    const lists = listsOf(input);
    const errors = [...listErrors(lists, object.id), ...missingMemberErrors(object, lists)];
    if (errors.length > 0) return reject(errors);
    const segments = editMembers(object.segments, lists.deleteSegmentIds, lists.setSegments);
    errors.push(...strayVertexErrors(object, lists, segments));
    if (errors.length > 0) return reject(errors);
    const vertices = joinedVertices(
      editMembers(object.vertices, lists.deleteVertexIds, lists.setVertices),
      segments,
    );
    const checked = checkObject(context.board, { ...object, vertices, segments }, errors);
    if (checked?.type !== 'path') return reject(errors);
    return accept({ id: object.id, vertices: checked.vertices, segments: checked.segments });
  },
  apply(transaction, input, plan) {
    transaction.patchObject(plan.id, {
      vertices: [...plan.vertices],
      segments: [...plan.segments],
    });
    return { id: plan.id };
  },
};
