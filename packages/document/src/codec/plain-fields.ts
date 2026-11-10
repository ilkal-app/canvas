import * as Y from 'yjs';

import type { FieldProblem } from './decode-issue.js';

/**
 * The own property names that would make a decoded container unusable as a primitive or a
 * plain record: lib0 carries no function, so such a key is never callable, and `<`, arithmetic,
 * `String()` and a template literal throw on the container. `__proto__` is here for a value a
 * hand-built decoder might keep as an own key; lib0's own `readAny` sets the prototype instead,
 * which the prototype check refuses.
 */
const BREAKING_KEYS = [
  'toString',
  'valueOf',
  'toJSON',
  'constructor',
  '__proto__',
  'then',
] as const;

/**
 * Whether a container is one JavaScript can convert and treat as a plain value: its prototype
 * is `Object.prototype` (`Array.prototype` for an array) and it has none of the
 * {@link BREAKING_KEYS} of its own. Own properties are checked without reading them.
 *
 * @param container - A plain container from a decoded field.
 * @returns Whether it is unconvertible.
 */
function isUnconvertible(container: object): boolean {
  const expected = Array.isArray(container) ? Array.prototype : Object.prototype;
  if (Object.getPrototypeOf(container) !== expected) return true;
  for (const key of BREAKING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(container, key)) return true;
  }
  return false;
}

/**
 * Adds only object-valued own enumerable children, without putting primitive leaves on the
 * worklist, and reports a `bigint` leaf. An array's keys are its own enumerable ones: the
 * indexes that hold a value (holes are skipped, as `Object.keys` skips them) and extension
 * properties. That is the set `deepFreeze` freezes, so the two walks reach the same members.
 *
 * @param value - The plain container being inspected.
 * @param pending - The remaining object containers to inspect.
 * @returns Whether one of the container's own members is a `bigint`.
 */
function appendContainers(value: object, pending: object[]): boolean {
  const record = value as Record<string, unknown>;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    let index = keys.length;
    while (index > 0) {
      index -= 1;
      const key = keys[index];
      if (key === undefined) continue;
      const member = record[key];
      if (typeof member === 'bigint') return true;
      if (typeof member === 'object' && member !== null) pending.push(member);
    }
    return false;
  }
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const member = record[key];
    if (typeof member === 'bigint') return true;
    if (typeof member === 'object' && member !== null) pending.push(member);
  }
  return false;
}

/**
 * Checks a decoded field without following a shared type back into its document or attempting
 * to freeze binary data, and refuses what JavaScript cannot convert: a `bigint` (JSON cannot write
 * it) and a container with an own `toString`, `valueOf`, `toJSON`, `constructor`, `__proto__` or
 * `then`, or a prototype other than the standard one (`<`, arithmetic, `String()` and template
 * literals throw on it). lib0 carries all of these, and every consumer that compares, adds or
 * formats a field would throw on it. Inspects enumerable members, including unknown extension keys.
 *
 * @param value - A decoded field, which should contain only plain values.
 * @param seen - Plain containers already inspected in this object.
 * @returns Whether a shared type, subdocument, binary value, bigint or unconvertible container is reachable from the field.
 */
function hasUnsafeValue(value: object, seen: Set<object>): boolean {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    if (
      current instanceof Y.AbstractType ||
      current instanceof Y.Doc ||
      ArrayBuffer.isView(current) ||
      current instanceof ArrayBuffer ||
      isUnconvertible(current)
    )
      return true;
    seen.add(current);
    if (appendContainers(current, pending)) return true;
  }
  return false;
}

/**
 * The problem a field that reaches an unsafe value is reported with.
 *
 * @param field - The field.
 * @returns The problem.
 */
function unsafeField(field: string): FieldProblem {
  return {
    field,
    message: 'a plain field contains a shared, binary, bigint or unconvertible value',
    isMissing: false,
  };
}

/**
 * Rejects shared, binary, bigint or unconvertible values left in decoded plain fields before any field is
 * frozen or inspected as schema data. Legitimate text, label and network shared types have already been decoded.
 * Package-internal; this does not validate schema ranges or alter the stored layout.
 *
 * @param fields - The decoded object's fields, including retained extension properties.
 * @returns The first unsafe field, or `null` when no field reaches a shared, binary, bigint or unconvertible value.
 */
export function plainFieldProblem(fields: Readonly<Record<string, unknown>>): FieldProblem | null {
  let seen: Set<object> | undefined;
  for (const field in fields) {
    if (!Object.hasOwn(fields, field)) continue;
    const value = fields[field];
    if (typeof value === 'bigint') return unsafeField(field);
    if (typeof value !== 'object' || value === null) continue;
    seen ??= new Set<object>();
    if (hasUnsafeValue(value, seen)) return unsafeField(field);
  }
  return null;
}
