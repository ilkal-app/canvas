import { z } from 'zod';

import {
  connectorObjectSchema,
  lineCapSchema,
  objectIdSchema,
  pageIdSchema,
  pointSchema,
  strokeSchema,
  strokeStyleFields,
  textContentSchema,
  unitPointSchema,
  type BoardObject,
  type ConnectorEnd,
  type ObjectId,
  type PageId,
  type Stroke,
} from '@canvas/schema';

import { checkObject, referenceErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { pageOfObject } from './pages/page-support.js';
import { SubBoard } from './sub-board.js';
import { boardToParentFrame } from './world-frame.js';
import { nextZAbove } from './z-placement.js';

/** The stroke of a connector made without one: 2 world px, near-black. */
const DEFAULT_CONNECTOR_STROKE: Stroke = { color: [0.1, 0.1, 0.12, 1], width: 2 };

/** Validates one end of a new connector: an object (with an anchor) or a point on the board. */
const connectEndSchema = z.union([
  z.strictObject({
    /** The object this end attaches to. */
    objectId: objectIdSchema.describe('The object this end attaches to.'),
    /** Where on the object's bounds, as fractions of its size; null (default) picks a side. */
    anchor: unitPointSchema
      .nullable()
      .default(null)
      .describe(
        "Where on the object's bounds, as fractions of its size; null (default) picks a side.",
      ),
  }),
  z.strictObject({
    /** A free end, world units in the board's frame. */
    point: pointSchema.describe("A free end, world units in the board's frame."),
  }),
]);

/** One end of {@link connectInputSchema}, parsed. */
type ConnectEnd = z.output<typeof connectEndSchema>;

/** Validates the input of {@link connectCommand}. */
export const connectInputSchema = z
  .strictObject({
    /** The new connector's id; generated when omitted. */
    id: objectIdSchema.optional().describe("The new connector's id; generated when omitted."),
    /** The group or frame the connector goes in, or null (the default) for the board root. */
    parentId: objectIdSchema
      .nullable()
      .default(null)
      .describe(
        'The group or frame the connector goes in, or null (the default) for the board root.',
      ),
    /** The page of a connector at the root; default: its targets' page, else the first. */
    pageId: pageIdSchema
      .optional()
      .describe(
        "The page of a connector at the board root; default: the page of the objects it connects, else the board's first page.",
      ),
    /** The start: an object, or a point on the board. */
    from: connectEndSchema.describe('The start: an object, or a point on the board.'),
    /** The end: an object, or a point on the board. */
    to: connectEndSchema.describe('The end: an object, or a point on the board.'),
    /** straight (default), elbow or curved. */
    route: connectorObjectSchema.shape.route.default('straight'),
    /** The line's colour and width; default 2 world px, near-black. */
    stroke: strokeSchema.default(DEFAULT_CONNECTOR_STROKE),
    /** The decoration at the start; default none. */
    startCap: lineCapSchema.default('none'),
    /** The decoration at the end; default arrow. */
    endCap: lineCapSchema.default('arrow'),
    // The stroke's dash, join, miter limit and cap; each absent unless given.
    ...strokeStyleFields,
    /** Text at the middle of the route, or null (the default) for none. */
    label: textContentSchema.nullable().default(null),
  })
  .describe(
    'Creates a connector between two objects, an object and a point on the board, or two points (a free line).',
  );

/** What {@link connectCommand} returns. */
export interface ConnectResult {
  /** The new connector's id. */
  readonly id: ObjectId;
}

/** The connector {@link connectCommand} will write. */
export interface ConnectPlan {
  /** The new connector, whole and validated. */
  readonly connector: BoardObject;
}

/**
 * A connector end as stored, with a free point placed at the connector's origin until the
 * connector's frame is known.
 *
 * @param end - The end as given.
 * @returns The stored end.
 */
function storedEnd(end: ConnectEnd): ConnectorEnd {
  return 'objectId' in end
    ? { kind: 'object', objectId: end.objectId, anchor: end.anchor }
    : { kind: 'point', x: 0, y: 0 };
}

/**
 * The page of the objects a connector connects: its first attached end's object's page.
 *
 * @param board - The board.
 * @param from - The start.
 * @param to - The end.
 * @returns The page, or `null` to leave it to the store (the first page).
 */
function targetsPage(board: BoardReader, from: ConnectEnd, to: ConnectEnd): PageId | null {
  for (const end of [from, to]) {
    if ('objectId' in end) return pageOfObject(board, board.get(end.objectId)) ?? null;
  }
  return null;
}

/**
 * `connect`: creates a connector between two objects, between an object
 * and a free point, or between two free points (a free line, with no ends a plain line). The connector goes in `parentId` (the root by default) at the
 * parent's origin, unrotated, on top of its siblings; free points are given in board
 * coordinates and stored in the connector's own frame. At the root it goes on its targets' page.
 * Refused when a target is missing, is a connector or a comment, or is on another
 * page than the connector (`cross-page`), or when the parent is not a group or frame.
 */
export const connectCommand: Command<typeof connectInputSchema, ConnectPlan, ConnectResult> = {
  name: 'connect',
  description:
    'Creates a connector between two objects, an object and a point on the board, or two points (a free line).',
  input: connectInputSchema,
  validate(context, input) {
    const { board, now } = context;
    const { from, to, pageId, ...style } = input;
    const id = input.id ?? context.createId();
    const errors: CommandError[] = [];
    if (board.get(id) !== undefined) {
      errors.push(commandError('duplicate-id', id, ['id'], `"${id}" is already in use`));
    }
    const z = nextZAbove(board, input.parentId, id, ['parentId'], errors);
    if (z === undefined) return reject(errors);
    const draft = checkObject(
      context.board,
      {
        ...style,
        id,
        type: 'connector',
        pageId: input.parentId === null ? (pageId ?? targetsPage(board, from, to)) : null,
        x: 0,
        y: 0,
        rotation: 0,
        z,
        locked: false,
        createdBy: context.origin.principalId,
        createdAt: now,
        updatedAt: now,
        from: storedEnd(from),
        to: storedEnd(to),
      },
      errors,
    );
    if (draft === undefined) return reject(errors);
    errors.push(...referenceErrors(board, [draft]));
    if (errors.length > 0) return reject(errors);
    const subBoard = new SubBoard(board, [draft]);
    subBoard.addWithAncestors(draft.id);
    const frames = subBoard.toBoard();
    const place = (end: ConnectEnd): ConnectorEnd | null => {
      if ('objectId' in end) return storedEnd(end);
      const point = boardToParentFrame(frames, draft, end.point);
      return point === null ? null : { kind: 'point', ...point };
    };
    const [placedFrom, placedTo] = [place(from), place(to)];
    if (placedFrom === null || placedTo === null) {
      const message = `the ancestors of parent "${String(input.parentId)}" form a cycle`;
      return reject([commandError('parent-cycle', id, ['parentId'], message)]);
    }
    const connector = checkObject(
      context.board,
      { ...draft, from: placedFrom, to: placedTo },
      errors,
    );
    return connector === undefined ? reject(errors) : accept({ connector });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.connector);
    return { id: plan.connector.id };
  },
};
