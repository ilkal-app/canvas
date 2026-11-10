import { z } from 'zod';

import { objectIdSchema, pageIdSchema, type BoardObject, type ObjectId } from '@canvas/schema';

import { checkObject } from './command-checks.js';
import { errorsFromIssues } from './command-error.js';
import { type Command, type CommandContext, type StagedPlanning } from './command.js';
import { orderByReferences, splitCreatedObjects } from './create-objects-parts.js';
import {
  finishCreate,
  locateInInput,
  planCreateObjects,
  prepareCreate,
  type CreateObjectsPlan,
} from './create-objects-plan.js';
import { newObjectSchema, type NewObject } from './new-object-schema.js';

/** Validates the input of {@link createObjectsCommand}. */
export const createObjectsInputSchema = z
  .strictObject({
    /**
     * The objects to create, as `createObject` takes one, bottom first within each parent. Their
     * ids are local to this list: every object gets a new id, and a `parentId`, connector end or
     * comment anchor naming another listed object is rewritten to that object's new id.
     */
    objects: z
      .array(newObjectSchema)
      .min(1)
      .describe(
        'The objects to create, bottom first within each parent. Their ids are local to this list: every object gets a new id, and references between listed objects follow. A parentId is another listed object, or null for the command parentId. Leave z out: every key is generated.',
      ),
    /** The group or frame the listed objects with a null `parentId` go in; the root if null. */
    parentId: objectIdSchema
      .nullable()
      .default(null)
      .describe(
        'The group or frame the listed objects with a null parentId go in; null (the default) for the board root.',
      ),
    /** The page the objects that land on the root go on; default the first page. */
    pageId: pageIdSchema
      .optional()
      .describe(
        "The page the objects that land on the board root go on; default: each object's own pageId, else the board's first page.",
      ),
    /**
     * Listed mains written as component sets: each is drawn as its default combination
     * (its axes' first values' records written on it, the other values given the fields back).
     */
    drawnDefaults: z
      .array(objectIdSchema)
      .optional()
      .describe(
        "Listed mains written as component sets, by listed id: each is drawn as its default combination, its axes' first values' records written on it and the other values given the fields back.",
      ),
  })
  .describe(
    'Creates several objects at once, as one step: fresh ids, references between them kept, stacked on top of their parent in the order given.',
  );

/** What {@link createObjectsCommand} returns. */
export interface CreateObjectsResult {
  /** The new ids, in the order of the input's `objects`. */
  readonly ids: readonly ObjectId[];
}

export type { CreateObjectsPlan } from './create-objects-plan.js';

/** The input of {@link createObjectsCommand}, after parsing. */
type CreateObjectsInput = z.output<typeof createObjectsInputSchema>;

/** How many objects one stage of `planInStages` parses or checks. */
const OBJECTS_PER_STAGE = 500;

/** The input with its objects left unparsed: the rest of it, parsed in one stage. */
const inputFrameSchema = createObjectsInputSchema.extend({
  objects: z.array(z.unknown()).min(1),
});

/**
 * `createObjects` planned a stage at a time (its `planInStages`): the input's objects
 * parsed, then checked as stored, some at a time, with `stage` awaited between, then the checks
 * across them. Same plan and refusals as its `validate`: an input that fails its parse is parsed
 * again whole to report it as `planCommand` does.
 *
 * @param context - The command's context.
 * @param input - The input, before parsing.
 * @param stage - Awaited between two stages.
 * @returns The parsed input, the plan and the objects it validated whole, or every problem.
 */
async function planCreateObjectsInStages(
  context: CommandContext,
  input: unknown,
  stage: () => Promise<void>,
): Promise<StagedPlanning<CreateObjectsInput, CreateObjectsPlan>> {
  const parsed = await parseInStages(input, stage);
  if (!parsed.isParsed) {
    return { isValid: false, errors: errorsFromIssues('invalid-input', null, parsed.issues) };
  }
  await stage();
  const prepared = prepareCreate(context, parsed.data);
  if ('errors' in prepared) return { isValid: false, errors: prepared.errors };
  const objectErrors = [...prepared.nameErrors];
  const objects: BoardObject[] = [];
  const { candidates } = prepared;
  for (let start = 0; start < candidates.length; start += OBJECTS_PER_STAGE) {
    await stage();
    for (const candidate of candidates.slice(start, start + OBJECTS_PER_STAGE)) {
      const object = checkObject(context.board, candidate, objectErrors);
      if (object !== undefined) objects.push(object);
    }
  }
  if (objectErrors.length > 0) {
    return { isValid: false, errors: locateInInput(objectErrors, prepared.indexById) };
  }
  await stage();
  const checked = new Set<BoardObject>(objects);
  const finished = finishCreate(context, parsed.data, objects, prepared);
  if (!finished.isValid) return finished;
  // Only the objects that reached the plan as `checkObject` validated them: a main a preset or a
  // drawn default replaced is validated again when it is written.
  const validated = finished.plan.objects.filter((object) => checked.has(object));
  return { isValid: true, input: parsed.data, plan: finished.plan, validated };
}

/**
 * Parses a `createObjects` input with its objects a stage at a time.
 *
 * @param input - The input, before parsing.
 * @param stage - Awaited between two stages.
 * @returns The parsed input, or the issues of parsing it whole.
 */
async function parseInStages(
  input: unknown,
  stage: () => Promise<void>,
): Promise<
  | { readonly isParsed: true; readonly data: CreateObjectsInput }
  | { readonly isParsed: false; readonly issues: readonly z.core.$ZodIssue[] }
> {
  const whole = () => {
    const parsed = createObjectsInputSchema.safeParse(input);
    return parsed.success
      ? { isParsed: true as const, data: parsed.data }
      : { isParsed: false as const, issues: parsed.error.issues };
  };
  const frame = inputFrameSchema.safeParse(input);
  if (!frame.success) return whole();
  const objects: NewObject[] = [];
  const entries = frame.data.objects;
  for (let start = 0; start < entries.length; start += OBJECTS_PER_STAGE) {
    await stage();
    for (const entry of entries.slice(start, start + OBJECTS_PER_STAGE)) {
      const parsed = newObjectSchema.safeParse(entry);
      if (!parsed.success) return whole();
      objects.push(parsed.data);
    }
  }
  return { isParsed: true, data: { ...frame.data, objects } };
}

/**
 * `createObjects`: creates several objects of
 * any type in one transaction, so a paste of N objects is one undo step; past
 * `MAX_OBJECTS_PER_TRANSACTION` (1,000) objects, in several transactions of at most that many,
 * each referring only to objects already written, still one undo step (each
 * transaction's update stays under the collab client's 1 MiB chunk). Every transaction writes
 * the objects referents first (a parent before its children, a connector's targets and a
 * comment's anchor before it), so a peer that applies part of one never sees a dangling
 * reference to a listed object. Every object gets a new
 * id from the command's generator; the listed ids are local to the input, and a `parentId`,
 * connector end or comment anchor that names another listed object is rewritten to its new id.
 * A listed object's `parentId` is another listed object or `null`, which puts it in the
 * command's `parentId`; a connector end or anchor that names no listed object must name an
 * object on the board. The objects going into the command's `parentId` stack on top of its
 * children, and every new parent's children from the bottom, each in input order; `z` must be
 * left out. `createdBy`, `createdAt` and `updatedAt` are stamped as by `createObject`. Refused,
 * writing nothing, when an entry is invalid or a reference breaks the schema's reference rules;
 * errors about an entry carry its input path (`['objects', index, …]`) and its new id.
 */
export const createObjectsCommand: Command<
  typeof createObjectsInputSchema,
  CreateObjectsPlan,
  CreateObjectsResult
> = {
  name: 'createObjects',
  description:
    'Creates several objects in one step with fresh ids, keeping references between them, stacked on top of their parent in the order given.',
  input: createObjectsInputSchema,
  validate: (context, input) => planCreateObjects(context, input),
  planInStages: planCreateObjectsInStages,
  apply(transaction, input, plan) {
    // Referents before referrers, whatever the input order: a peer that receives the
    // transaction's update in chunks repairs any reference whose target has not arrived yet.
    for (const object of orderByReferences(plan.objects)) transaction.setObject(object);
    return { ids: plan.objects.map((object) => object.id) };
  },
  split: (plan, options) => splitCreatedObjects(plan, options),
};
