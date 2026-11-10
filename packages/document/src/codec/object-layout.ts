import * as Y from 'yjs';

import {
  commentObjectSchema,
  componentObjectSchema,
  connectorObjectSchema,
  frameObjectSchema,
  freehandObjectSchema,
  groupObjectSchema,
  imageObjectSchema,
  instanceObjectSchema,
  lineObjectSchema,
  linkObjectSchema,
  pathObjectSchema,
  shapeObjectSchema,
  stickyObjectSchema,
  textObjectSchema,
  videoObjectSchema,
  type ObjectType,
} from '@canvas/schema';

import { KIND, shallowKindsOf } from './field-kinds.js';
import type { PairCodec } from './pair-codec.js';
import { LAST_PARAGRAPH_KEY } from './paragraph-codec.js';
import { EMPTY_TEXT_STYLE_KEY, TEXT_KEY } from './rich-text-codec.js';

// The grouped-field layout. Yjs spends one item, about
// 400 bytes of heap, per key of a `Y.Map`, and the per-field layout of spent about 20
// items per object before any text. Here the fields that are always written together are one
// plain value, and the fields people edit concurrently for different reasons keep their own
// key, so a move and a recolour, a restyle and a text edit, or a reorder and a resize of one
// object still merge. Placement is one group: a reparent writes `parentId` with the
// object's position in the new parent's frame, a move writes the position in the current
// parent's frame, and the two must never mix, or the object jumps by the frames' offset. The
// store reads and writes only this layout; a document says which layout it holds in its
// metadata (`meta/document-meta.ts`), and one written in an earlier layout is refused on load.

/** The names of the grouped values, each one plain object holding several schema fields. */
export const GROUP_KEYS = ['identity', 'placement', 'size', 'style'] as const;

/** One of {@link GROUP_KEYS}. */
export type GroupKey = (typeof GROUP_KEYS)[number];

/** The key of the `identity` group, which every object's map holds. */
export const IDENTITY_KEY: GroupKey = 'identity';

/**
 * How one field, or one group of fields, of an object is stored in the object's `Y.Map`:
 *
 * - `group`: several plain fields in one plain object under `key`, replaced as a whole (last
 *   writer wins over the group). `identity` (`id`, `type`, `createdBy`, `createdAt`) is written
 *   once; `placement` (`parentId`, `pageId`, `x`, `y`, `rotation`: where the object sits, in
 *   its parent's frame, and a root object's page, layout 4) by moves, rotations, reparents,
 *   grouping, page moves and the reference repair, always whole; a placement stored before
 *   layout 4 has no `pageId` (`placement-page.ts` reads it);
 *   `size` (`width`, `height`) by resizes; `style` holds every other plain field of the type
 *   (its appearance and settings), written by restyles.
 * - `plain`: one field under its own key, replaced as a whole: `z`, `locked`, `updatedAt`, and
 *   the fields dragged or repaired on their own (connector ends, a comment's anchor).
 * - `stroke-data`: a freehand stroke's `points` or `pressures` (layout 29): one plain
 *   value under a key of its own, `strokePoints` or `strokePressures`, replaced whole. The keys
 *   are not the fields' names because the relay judges a value by its key alone, and `points` is
 *   a line's whole pair on boards stored before the split (`meta/field-values.ts`).
 * - `pair`: a two-member field (a line's `points`) as one own key per member (`points.0`,
 *   `points.1`), since each end is dragged on its own (`pair-codec.ts`); a board stored before
 *   the split holds the whole pair under the field's name, read for a member whose key is
 *   absent.
 * - `inline-text`: a text object's or sticky's `text`, `runs` and `paragraphs`: a `Y.Text` under
 *   `text`, plus the style of empty text and the last paragraph's list style
 *   (`rich-text-codec.ts`).
 * - `label`: a shape's or connector's `label`: `null`, or a nested `Y.Map` holding the same
 *   rich-text layout.
 * - `network`: a path's `vertices` or `segments`: a `Y.Map` from member id to
 *   `[order, member]` (`network-codec.ts`).
 * - `overrides`: an instance's `overrides`: a `Y.Map` from path to plain record
 *   (`override-codec.ts`).
 * - `presets`: a main's `variantPresets`: a `Y.Map` from `axis=value` to such an
 *   override map (`presets-codec.ts`), so different presets and paths merge.
 */
export type FieldCodec =
  | { readonly kind: 'group'; readonly key: GroupKey; readonly fields: readonly string[] }
  | { readonly kind: 'plain'; readonly key: string }
  | { readonly kind: 'stroke-data'; readonly key: string; readonly field: string }
  | ({ readonly kind: 'pair' } & PairCodec)
  | { readonly kind: 'inline-text' }
  | { readonly kind: 'label'; readonly key: string }
  | { readonly kind: 'network'; readonly key: string }
  | { readonly kind: 'overrides'; readonly key: string }
  | { readonly kind: 'presets'; readonly key: string };

/** How one object type is stored. */
export interface ObjectLayout {
  /** The type's schema field names in schema order: the order of a decoded object's fields. */
  readonly fieldNames: readonly string[];
  /** The codecs, groups first (`identity` first of all). */
  readonly codecs: readonly FieldCodec[];
  /** Every key the layout writes in an object's map. */
  readonly keys: ReadonlySet<string>;
  /**
   * The top-level kinds (`field-kinds.ts`) each plain field of the type may hold, from its
   * schema: every field but the text, label and network fields, which their codecs decode.
   */
  readonly kinds: readonly (readonly [field: string, kinds: number])[];
}

/** The schema of each object type, read for its field names. */
const OBJECT_SCHEMAS = {
  text: textObjectSchema,
  sticky: stickyObjectSchema,
  image: imageObjectSchema,
  video: videoObjectSchema,
  shape: shapeObjectSchema,
  line: lineObjectSchema,
  connector: connectorObjectSchema,
  path: pathObjectSchema,
  freehand: freehandObjectSchema,
  group: groupObjectSchema,
  frame: frameObjectSchema,
  comment: commentObjectSchema,
  component: componentObjectSchema,
  instance: instanceObjectSchema,
  link: linkObjectSchema,
} as const satisfies Record<ObjectType, { readonly shape: object }>;

/**
 * The fields of the three fixed groups; every other plain field goes to `style`. How an object
 * sits in an auto-layout container (`layoutChild`) and whether an instance keeps its own size
 * (`isWidthFixed`, `isHeightFixed`) and its content scale (`scale`) are sizing, stored in
 * `size`: every type that can
 * hold them has that group, while an instance has no `style` group, so these optional fields add
 * no key (the `packages/document` README, "Changing the stored layout").
 */
const FIXED_GROUPS: readonly (readonly [GroupKey, ReadonlySet<string>])[] = [
  ['identity', new Set(['id', 'type', 'createdBy', 'createdAt', 'mainId'])],
  ['placement', new Set(['parentId', 'pageId', 'x', 'y', 'rotation'])],
  ['size', new Set(['width', 'height', 'layoutChild', 'isWidthFixed', 'isHeightFixed', 'scale'])],
];

/**
 * Plain fields that keep their own key. `z` is the stacking order a reorder writes without a
 * move, and must merge with one; `locked` is toggled on its own; `updatedAt` is stamped by every
 * command, so in a group it would make every command conflict with every other on that group;
 * connector ends and a comment's anchor are dragged, and repaired after concurrent deletes,
 * independently of the object's style. An instance's variant selection (`variant`) is
 * switched on its own, and an instance has no `style` group; nor does a slot's `swapOptions`,
 * edited on its own.
 */
const OWN_KEY_FIELDS: ReadonlySet<string> = new Set([
  'constraints',
  'retired',
  'variant',
  'swapOptions',
  'z',
  'locked',
  'updatedAt',
  'from',
  'to',
  'anchor',
]);

/**
 * Two-member fields with one own key per member: a line's two ends (fix round 1), dragged
 * one at a time and by different people at once.
 */
const PAIR_FIELDS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['points', ['points.0', 'points.1']],
]);

/**
 * A freehand stroke's point data (layout 29), by field: the stored key of each array,
 * written once with the stroke and replaced whole by a resize, so a restyle of the same stroke
 * merges with it. A stroke's `points` is a flat array, not a line's pair, so it has a key of its
 * own (`stroke-data` above).
 */
export const FREEHAND_KEYS: ReadonlyMap<string, string> = new Map([
  ['points', 'strokePoints'],
  ['pressures', 'strokePressures'],
]);

/**
 * A link card's preview (layout 36): what the paster's client writes once the page is
 * fetched, each under its own key, so a layout switch or a restyle of the card meanwhile (the
 * `style` group) merges with it instead of one replacing the other.
 */
export const LINK_CARD_OWN_KEY_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'siteName',
  'imageAssetId',
  'imageSize',
  'faviconAssetId',
  'faviconSize',
  'status',
  'unfurlKey',
]);

/** Fields stored as keyed maps of members (a path's vector network). */
const NETWORK_FIELDS: ReadonlySet<string> = new Set(['vertices', 'segments']);

/**
 * Finds the fixed group a field belongs to.
 *
 * @param field - A schema field name.
 * @returns The group's key, or `undefined` when the field is in no fixed group.
 */
function fixedGroupOf(field: string): GroupKey | undefined {
  return FIXED_GROUPS.find(([, fields]) => fields.has(field))?.[0];
}

/**
 * Derives the layout of one object type from its schema's fields, so a field added to the
 * schema is stored (in the `style` group) without touching the codec.
 *
 * @param type - The object type.
 * @param shape - The type's schema fields, by name, in schema order.
 * @returns The layout.
 */
function deriveLayout(type: string, shape: Readonly<Record<string, unknown>>): ObjectLayout {
  const fieldNames = Object.keys(shape);
  const hasInlineText = fieldNames.includes('text') && fieldNames.includes('runs');
  const groups = new Map<GroupKey, string[]>(GROUP_KEYS.map((key) => [key, []]));
  const others: FieldCodec[] = [];
  for (const field of fieldNames) {
    const group = fixedGroupOf(field);
    const strokeKey = type === 'freehand' ? FREEHAND_KEYS.get(field) : undefined;
    const parts = PAIR_FIELDS.get(field);
    if (hasInlineText && (field === 'runs' || field === 'paragraphs')) continue;
    if (group !== undefined) groups.get(group)?.push(field);
    else if (hasInlineText && field === 'text') others.push({ kind: 'inline-text' });
    else if (field === 'label') others.push({ kind: 'label', key: field });
    else if (field === 'overrides') others.push({ kind: 'overrides', key: field });
    else if (field === 'variantPresets') others.push({ kind: 'presets', key: field });
    else if (NETWORK_FIELDS.has(field)) others.push({ kind: 'network', key: field });
    else if (strokeKey !== undefined) others.push({ kind: 'stroke-data', key: strokeKey, field });
    else if (OWN_KEY_FIELDS.has(field)) others.push({ kind: 'plain', key: field });
    else if (type === 'link' && LINK_CARD_OWN_KEY_FIELDS.has(field)) {
      others.push({ kind: 'plain', key: field });
    } else if (parts !== undefined) others.push({ kind: 'pair', key: field, parts });
    else groups.get('style')?.push(field);
  }
  const codecs: FieldCodec[] = [
    ...[...groups]
      .filter(([, fields]) => fields.length > 0)
      .map(([key, fields]): FieldCodec => ({ kind: 'group', key, fields })),
    ...others,
  ];
  const keys = new Set(
    codecs.flatMap((codec) => {
      if (codec.kind === 'inline-text') return [TEXT_KEY, EMPTY_TEXT_STYLE_KEY, LAST_PARAGRAPH_KEY];
      return codec.kind === 'pair' ? [...codec.parts] : [codec.key];
    }),
  );
  const kinds: (readonly [string, number])[] = [];
  for (const field of fieldNames) {
    const isDecodedByCodec =
      field === 'label' ||
      field === 'overrides' ||
      field === 'variantPresets' ||
      NETWORK_FIELDS.has(field) ||
      (hasInlineText && (field === 'text' || field === 'runs' || field === 'paragraphs'));
    if (!isDecodedByCodec) kinds.push([field, shallowKindsOf(shape[field])]);
  }
  return { fieldNames, codecs, keys, kinds };
}

/** The layout of every object type. */
const LAYOUTS = new Map<string, ObjectLayout>(
  Object.entries(OBJECT_SCHEMAS).map(([type, schema]) => [type, deriveLayout(type, schema.shape)]),
);

/**
 * Looks up how an object type is stored.
 *
 * @param type - A stored `type` value, which may come from a remote peer.
 * @returns The layout, or `undefined` for an unknown type.
 */
export function layoutOf(type: unknown): ObjectLayout | undefined {
  return typeof type === 'string' ? LAYOUTS.get(type) : undefined;
}

/**
 * Whether the schema lets an object leave a field out: its kinds include `undefined`
 * (`pageId`, a frame's `showName`). The writer never stores `undefined`, so such a field
 * is absent from its group.
 *
 * @param layout - The layout of the object's type.
 * @param field - The field.
 * @returns `true` for an optional field.
 */
export function isOptionalField(layout: ObjectLayout, field: string): boolean {
  return layout.kinds.some(
    ([name, accepted]) => name === field && (accepted & KIND.undefined) !== 0,
  );
}

/**
 * Whether every field of a group is optional (an instance's or main's `style`, which holds only
 * `colorMode`): the writer stores such a group only once a field is set, and the reader
 * takes a missing key as the empty group, so objects stored before the field existed read.
 *
 * @param layout - The layout of the object's type.
 * @param fields - The group's fields.
 * @returns `true` when the group may be absent.
 */
export function isOptionalGroup(layout: ObjectLayout, fields: readonly string[]): boolean {
  return fields.every((field) => isOptionalField(layout, field));
}

/**
 * Reads the stored type of an object's map without decoding the object.
 *
 * @param map - An object's map.
 * @returns The stored `type` value, which may be anything a peer wrote; `undefined` when the
 *   map has no readable `identity` group.
 */
export function storedTypeOf(map: Y.Map<unknown>): unknown {
  const identity = map.get(IDENTITY_KEY);
  return typeof identity === 'object' && identity !== null && !(identity instanceof Y.AbstractType)
    ? (identity as Readonly<Record<string, unknown>>).type
    : undefined;
}
