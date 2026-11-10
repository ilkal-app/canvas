import { drawableValuesReason, type DrawableValueKind } from '@canvas/schema';

import { layoutOf, type FieldCodec } from '../codec/object-layout.js';
import { isSamePlainValue } from '../codec/plain-value.js';

import type { ValidationIssue } from './document-write-error.js';

// Door consistency (item 1): nothing a write stores may be refused by the relay's door
// (part 1, `meta/field-values.ts`). The door judges the stored values a renderer draws
// (`drawableValuesReason`), by key of the object's map, and lets through a field written as the
// hub already holds it. So every write is held here to the same judgement, on exactly the keys
// the codec will set (a group or key whose value changed, a network member that changed): a
// write that would store a new value the door refuses is refused locally, as `invalid-object`
// naming the field, and never reaches the relay to close the connection with 4426.
//
// One exception: an object's size is judged whole, never let through as stored. The
// hub's size may no longer be the one this client holds (another client resized the object back
// into range meanwhile, or this client was offline when it did), and the door then refuses the
// width this client kept and closes it for good, while the hub's repair must stay. A size is
// what honest commands derive (a resize by a change, a group's scale, a crop), so a size the
// door refuses refuses every write of the size group until a write replaces it.

/**
 * What the door judges each key of an object's map as: the same table as the door's own
 * (`judgedKindOf` in `meta/field-values.ts`, which `door-values.test.ts` holds this to).
 */
export const DOOR_KINDS_BY_KEY: ReadonlyMap<string, DrawableValueKind> = new Map([
  ['placement', 'placement'],
  ['size', 'size'],
  ['style', 'style'],
  ['points.0', 'point'],
  ['points.1', 'point'],
  ['strokePoints', 'stroke-points'],
  ['strokePressures', 'stroke-pressures'],
]);

/** What the door judges each network's members as. */
export const DOOR_KINDS_BY_NETWORK: ReadonlyMap<string, DrawableValueKind> = new Map([
  ['vertices', 'vertex'],
  ['segments', 'segment'],
]);

/** An object's fields, as a write holds them or as they are stored. */
type Fields = Readonly<Record<string, unknown>>;

/** The key of an object's size group (`width`, `height`). */
const SIZE_KEY = 'size';

/**
 * Judges one stored value as the door does.
 *
 * @param kind - What it holds.
 * @param value - The value the write stores.
 * @param stored - The value stored there, when there is one.
 * @param path - Where the value sits in the object, for the issue.
 * @returns The issue, or `undefined` when the door lets it through.
 */
function judge(
  kind: DrawableValueKind,
  value: unknown,
  stored: { readonly value: unknown } | undefined,
  path: readonly (string | number)[],
): ValidationIssue | undefined {
  const finding = drawableValuesReason(kind, value, stored && (() => stored));
  if (finding === undefined) return undefined;
  const field = finding.field.split('.').filter((segment) => segment !== '');
  const named = [...path, ...field].join('.');
  return {
    path: [...path, ...field],
    message: `${named} would be refused by the relay (${finding.reason}): a renderer cannot draw it`,
  };
}

/**
 * Builds a group's value from an object's fields, as the codec stores it.
 *
 * @param fields - The object's fields.
 * @param names - The group's fields.
 * @returns The group's value.
 */
function groupOf(fields: Fields, names: readonly string[]): Fields {
  return Object.fromEntries(names.map((name) => [name, fields[name]]));
}

/**
 * Judges the values one codec of the layout stores.
 *
 * @param codec - The codec.
 * @param object - The object as written.
 * @param stored - The object as stored, or `undefined` for a new one.
 * @returns The issues.
 */
function codecIssues(
  codec: FieldCodec,
  object: Fields,
  stored: Fields | undefined,
): (ValidationIssue | undefined)[] {
  switch (codec.kind) {
    case 'group': {
      const kind = DOOR_KINDS_BY_KEY.get(codec.key);
      if (kind === undefined) return [];
      const value = groupOf(object, codec.fields);
      const before = stored && groupOf(stored, codec.fields);
      if (before !== undefined && isSamePlainValue(before, value)) return [];
      // A size is never let through as stored (see the note at the top).
      const held = codec.key === SIZE_KEY ? undefined : before && { value: before };
      return [judge(kind, value, held, [])];
    }
    case 'pair':
      return ([0, 1] as const).map((index) => {
        const kind = DOOR_KINDS_BY_KEY.get(codec.parts[index]);
        const value = (object[codec.key] as readonly unknown[])[index];
        const pair = stored?.[codec.key];
        const before = Array.isArray(pair) ? { value: pair[index] as unknown } : undefined;
        if (kind === undefined || (before !== undefined && isSamePlainValue(before.value, value))) {
          return undefined;
        }
        return judge(kind, value, before, [codec.key, index]);
      });
    case 'stroke-data': {
      // A freehand stroke's arrays, judged under their stored keys' kinds.
      const kind = DOOR_KINDS_BY_KEY.get(codec.key);
      const value = object[codec.field];
      const before = stored?.[codec.field];
      if (kind === undefined || value === undefined) return [];
      if (before !== undefined && isSamePlainValue(before, value)) return [];
      return [
        judge(kind, value, before === undefined ? undefined : { value: before }, [codec.field]),
      ];
    }
    case 'network':
      return networkIssues(codec.key, object, stored);
    default:
      return [];
  }
}

/**
 * Judges the members of a network a write sets: each that differs from the stored member with
 * its id.
 *
 * @param key - `vertices` or `segments`.
 * @param object - The object as written.
 * @param stored - The object as stored, or `undefined` for a new one.
 * @returns The issues.
 */
function networkIssues(
  key: string,
  object: Fields,
  stored: Fields | undefined,
): (ValidationIssue | undefined)[] {
  const kind = DOOR_KINDS_BY_NETWORK.get(key);
  const members = object[key];
  if (kind === undefined || !Array.isArray(members)) return [];
  const held = new Map<unknown, unknown>();
  const storedMembers = stored?.[key];
  if (Array.isArray(storedMembers)) {
    for (const member of storedMembers as readonly unknown[]) {
      held.set((member as { readonly id?: unknown } | null)?.id, member);
    }
  }
  return (members as readonly unknown[]).map((member, index) => {
    const id = (member as { readonly id?: unknown } | null)?.id;
    const before = held.has(id) ? { value: held.get(id) } : undefined;
    if (before !== undefined && isSamePlainValue(before.value, member)) return undefined;
    return judge(kind, member, before, [key, index]);
  });
}

/**
 * The values a write stores that the relay's door would refuse (part 1): for each key of
 * the object's map the door judges (`placement`, `size`, `style`, a line's ends, a path's
 * members), the value the codec would store there, unless it is the stored value (then the codec
 * writes nothing), judged by `drawableValuesReason` against the stored value as the door judges
 * it against the hub's. Pure; O(the object's judged values).
 *
 * @param object - The object as the write leaves it; its fields already validated as written.
 * @param stored - The object as stored, or `undefined` for a new one.
 * @returns One issue per refused value, each naming its field.
 */
export function findDoorIssues(object: Fields, stored: Fields | undefined): ValidationIssue[] {
  const layout = layoutOf(object.type);
  if (layout === undefined) return [];
  return layout.codecs
    .flatMap((codec) => codecIssues(codec, object, stored))
    .filter((issue): issue is ValidationIssue => issue !== undefined);
}

/**
 * The issues of an object's size that is not finite, for a command that derives new
 * values from the stored size: a group's resize, which scales the size of every boxed object the
 * group holds (a size that is not finite leaves the group's box unscalable), and an image's crop,
 * which derives the box's place from it (and from one that is not finite derives no place). A
 * finite size past the door's range can still be scaled or cropped into it; what the command
 * writes is then judged as any write (`findDoorIssues`). Pure.
 *
 * @param object - A stored object.
 * @returns One issue per width or height that is not finite; none for an object without a size.
 */
export function findUnscalableSizeIssues(object: Fields): ValidationIssue[] {
  if (!('width' in object)) return [];
  return (['width', 'height'] as const)
    .filter((field) => typeof object[field] !== 'number' || !Number.isFinite(object[field]))
    .map((field) => ({
      path: [field],
      message: `${field} is not finite: nothing can be derived from it`,
    }));
}
