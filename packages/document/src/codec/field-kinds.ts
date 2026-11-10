import type { FieldProblem } from './decode-issue.js';

/**
 * The top-level kinds a decoded value can have, as bits, so a field's allowed kinds are one
 * number and the check is one AND. Package-internal.
 */
export const KIND = {
  string: 1,
  number: 2,
  boolean: 4,
  null: 8,
  undefined: 16,
  array: 32,
  object: 64,
} as const;

/** Every kind: what a field of a schema this module does not understand may hold. */
const ANY_KIND = 127;

/** The names of the kinds, for a message, by bit. */
const KIND_NAMES: readonly (readonly [number, string])[] = [
  [KIND.string, 'a string'],
  [KIND.number, 'a number'],
  [KIND.boolean, 'a boolean'],
  [KIND.null, 'null'],
  [KIND.undefined, 'nothing'],
  [KIND.array, 'an array'],
  [KIND.object, 'an object'],
];

/** The part of a Zod definition this module reads. */
interface ZodDefinition {
  readonly type?: string;
  readonly innerType?: unknown;
  readonly in?: unknown;
  readonly options?: readonly unknown[];
  readonly values?: readonly unknown[];
}

/**
 * Reads the definition of a Zod 4 schema.
 *
 * @param schema - A schema.
 * @returns Its definition, or an empty one when it has none.
 */
function definitionOf(schema: unknown): ZodDefinition {
  const zod = Reflect.get(Object(schema), '_zod') as { readonly def?: ZodDefinition } | undefined;
  return zod?.def ?? {};
}

/**
 * The kind of a literal value a schema accepts.
 *
 * @param value - The literal.
 * @returns Its kind bit, or every kind for one this module does not know.
 */
function literalKind(value: unknown): number {
  if (typeof value === 'string') return KIND.string;
  if (typeof value === 'number') return KIND.number;
  if (typeof value === 'boolean') return KIND.boolean;
  return value === null ? KIND.null : ANY_KIND;
}

/**
 * The top-level kinds a field's schema accepts: `string` for a string, an enum or a string
 * literal, `number`, `boolean`, `array` for an array or a tuple, `object` for an object, a
 * record or a map, the union of a union's options, `null` added by `nullable` and nothing by
 * `optional` (`undefined`), and through `default`, `readonly`, `catch`, `brand`, refinements and
 * a pipe's input. A schema it does not understand accepts every kind, so it never refuses what
 * the schema might accept. Only the top level is read: the elements of an array and the fields
 * of an object are the schema's to validate (`boardObjectSchema`), which the reader does not run.
 *
 * @param schema - A Zod schema of one field.
 * @returns The kinds as bits.
 */
export function shallowKindsOf(schema: unknown): number {
  const definition = definitionOf(schema);
  switch (definition.type) {
    case 'string':
    case 'enum':
    case 'template_literal':
      return KIND.string;
    case 'number':
      return KIND.number;
    case 'boolean':
      return KIND.boolean;
    case 'literal':
      return (definition.values ?? []).reduce<number>(
        (kinds, value) => kinds | literalKind(value),
        0,
      );
    case 'array':
    case 'tuple':
      return KIND.array;
    case 'object':
    case 'record':
    case 'map':
      return KIND.object;
    case 'nullable':
      return shallowKindsOf(definition.innerType) | KIND.null;
    case 'optional':
      return shallowKindsOf(definition.innerType) | KIND.undefined;
    case 'default':
    case 'readonly':
    case 'catch':
      return shallowKindsOf(definition.innerType);
    case 'pipe':
      return shallowKindsOf(definition.in);
    case 'union':
      return (definition.options ?? []).reduce<number>(
        (kinds, option) => kinds | shallowKindsOf(option),
        0,
      );
    default:
      return ANY_KIND;
  }
}

/**
 * The kind of a decoded value.
 *
 * @param value - A decoded value.
 * @returns Its kind bit.
 */
export function kindOfValue(value: unknown): number {
  switch (typeof value) {
    case 'string':
      return KIND.string;
    case 'number':
      return KIND.number;
    case 'boolean':
      return KIND.boolean;
    case 'undefined':
      return KIND.undefined;
    case 'object':
      if (value === null) return KIND.null;
      return Array.isArray(value) ? KIND.array : KIND.object;
    default:
      return 0;
  }
}

/**
 * Words a set of kinds: `a number`, `a string or null`.
 *
 * @param kinds - The kinds as bits.
 * @returns The text.
 */
function nameKinds(kinds: number): string {
  return KIND_NAMES.filter(([bit]) => (kinds & bit) !== 0)
    .map(([, name]) => name)
    .join(' or ');
}

/**
 * Finds the first known field whose value is not of a kind the schema accepts, before any code
 * compares, adds, formats or calls a method on it. Run on the fields of a decoded object once
 * `plainFieldProblem` has refused what JavaScript cannot convert.
 *
 * @param kinds - The field and accepted kinds of each checked field of the object's type.
 * @param fields - The decoded fields.
 * @returns The first offending field, or `null`.
 */
export function fieldKindProblem(
  kinds: readonly (readonly [string, number])[],
  fields: Readonly<Record<string, unknown>>,
): FieldProblem | null {
  for (const [field, accepted] of kinds) {
    if ((kindOfValue(fields[field]) & accepted) !== 0) continue;
    return { field, message: `expected ${nameKinds(accepted)}`, isMissing: false };
  }
  return null;
}
