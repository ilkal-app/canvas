import { z } from 'zod';

import { pointSchema } from '../fields/point.js';

/**
 * How the two handles at a vertex with exactly two segment ends follow each other (the
 * prototype's `Mirror`, `src/vector/model.ts`): `none` moves them independently, `angle` keeps
 * them collinear, `both` also keeps their lengths equal.
 */
export const MIRROR_MODES = ['none', 'angle', 'both'] as const;

/** Validates a path-local id for a vertex or segment: 1 to 64 characters, unique in its path. */
const networkIdSchema = z.string().min(1).max(64);

/** Validates a vertex of a vector network: a point in the path's own frame. */
export const vertexSchema = z.strictObject({
  /** Vertex id, unique within the path. */
  id: networkIdSchema.describe('Vertex id, unique within the path.'),
  /** x in the path's own frame, world units. */
  x: z.number().describe("x in the path's own frame, world units."),
  /** y in the path's own frame, world units. */
  y: z.number().describe("y in the path's own frame, world units."),
  /** How the handles at this vertex follow each other. */
  mirror: z.enum(MIRROR_MODES).describe('How the handles at this vertex follow each other.'),
});

/** A vertex of a vector network. */
export type Vertex = z.output<typeof vertexSchema>;

/**
 * Validates a segment of a vector network: a cubic Bézier from vertex `a` to vertex `b`. `ha`
 * and `hb` are the handle offsets from `a` and `b`; both zero is a straight line. Segments own
 * their handles, so a vertex can join any number of segments (the prototype's model).
 */
export const segmentSchema = z.strictObject({
  /** Segment id, unique within the path. */
  id: networkIdSchema.describe('Segment id, unique within the path.'),
  /** The id of the start vertex. */
  a: networkIdSchema.describe('The id of the start vertex.'),
  /** The id of the end vertex. */
  b: networkIdSchema.describe('The id of the end vertex.'),
  /** Handle offset from vertex a, world units; zero for a straight end. */
  ha: pointSchema.describe('Handle offset from vertex a, world units; zero for a straight end.'),
  /** Handle offset from vertex b, world units; zero for a straight end. */
  hb: pointSchema.describe('Handle offset from vertex b, world units; zero for a straight end.'),
});

/** A segment of a vector network. */
export type Segment = z.output<typeof segmentSchema>;

/**
 * Lists the ways a vector network is malformed (the prototype's `connect` refuses the same
 * cases, `src/vector/network.ts`): duplicate vertex or segment ids, a segment whose end is not a
 * vertex, a segment from a vertex to itself, and two segments joining the same pair of vertices.
 *
 * @param vertices - The network's vertices.
 * @param segments - The network's segments.
 * @returns One human-readable message per problem; empty when the network is well formed.
 */
export function findNetworkIssues(
  vertices: readonly Vertex[],
  segments: readonly Segment[],
): string[] {
  const issues: string[] = [];
  const vertexIds = new Set<string>();
  for (const vertex of vertices) {
    if (vertexIds.has(vertex.id)) issues.push(`vertex id "${vertex.id}" is used twice`);
    vertexIds.add(vertex.id);
  }
  const segmentIds = new Set<string>();
  const joinedPairs = new Set<string>();
  for (const segment of segments) {
    if (segmentIds.has(segment.id)) issues.push(`segment id "${segment.id}" is used twice`);
    segmentIds.add(segment.id);
    for (const end of [segment.a, segment.b]) {
      if (!vertexIds.has(end))
        issues.push(`segment "${segment.id}" ends at missing vertex "${end}"`);
    }
    if (segment.a === segment.b)
      issues.push(`segment "${segment.id}" joins vertex "${segment.a}" to itself`);
    // An unordered pair key; JSON.stringify keeps ids containing any character unambiguous.
    const pairKey = JSON.stringify([segment.a, segment.b].sort());
    if (joinedPairs.has(pairKey)) {
      issues.push(
        `segment "${segment.id}" joins "${segment.a}" and "${segment.b}", which are already joined`,
      );
    }
    joinedPairs.add(pairKey);
  }
  return issues;
}
