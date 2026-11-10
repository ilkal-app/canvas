import * as Y from 'yjs';

import {
  effectStyleValueSchema,
  principalIdSchema,
  styleIdSchema,
  styleNameSchema,
  textStyleValueSchema,
  type EffectStyleEntry,
  type EffectStyleTable,
  type PrincipalId,
  type StyleId,
  type TextStyleEntry,
  type TextStyleTable,
} from '@canvas/schema';

import { isSamePlainValue } from '../codec/plain-value.js';
import { DocumentWriteError } from '../store/document-write-error.js';

// The stored layout of the board's named styles: two top-level `Y.Map`s,
// `textStyles` and `effectStyles`, one plain value per key and three keys per style, as the
// colour tokens: `<id>.identity` (`{ createdBy, createdAt }`; the style exists
// iff this key does), `<id>.name` and `<id>.value` (the whole value: a text style's six fields,
// an effect style's `{ shadows }`; a value is replaced, not merged, so its layers stay a set). A
// key without its `.identity` (an edit concurrent with the style's delete) is ignored, and a
// style whose name or value is unreadable is not listed. These names and keys are part of the
// persisted format.

/** Which table of named styles. */
export type StyleKind = 'text' | 'effect';

/** The name of the document's top-level map of text styles. Part of the persisted format. */
export const TEXT_STYLES_MAP_NAME = 'textStyles';

/** The name of the document's top-level map of effect styles. Part of the persisted format. */
export const EFFECT_STYLES_MAP_NAME = 'effectStyles';

/** Each kind's map name. */
export const STYLE_MAP_NAMES: Readonly<Record<StyleKind, string>> = Object.freeze({
  text: TEXT_STYLES_MAP_NAME,
  effect: EFFECT_STYLES_MAP_NAME,
});

/** The three keys of a style, by field. */
export const STYLE_FIELDS = ['identity', 'name', 'value'] as const;

/** One of {@link STYLE_FIELDS}. */
export type StyleField = (typeof STYLE_FIELDS)[number];

/** What a style's `.identity` key holds: who created it (`null` when unknown) and when. */
export interface StyleIdentity {
  /** The creating principal, or `null` when unknown. */
  readonly createdBy: PrincipalId | null;
  /** When it was created, ms since the epoch. */
  readonly createdAt: number;
}

/** A style table of either kind. */
export type StyleTable<Kind extends StyleKind> = Kind extends 'text'
  ? TextStyleTable
  : EffectStyleTable;

/** A style entry of either kind. */
export type StyleEntry<Kind extends StyleKind> = Kind extends 'text'
  ? TextStyleEntry
  : EffectStyleEntry;

/** A style as a command writes it: its id, name and value. */
export interface StyleWrite<Kind extends StyleKind = StyleKind> {
  /** The style's id. */
  readonly id: StyleId;
  /** Its name. */
  readonly name: string;
  /** Its value. */
  readonly value: StyleEntry<Kind>['value'];
}

/** Who creates a style entry, and when: what its `.identity` key records. */
export interface StyleCreation {
  /** The principal of the command. */
  readonly createdBy: PrincipalId;
  /** The command's time, ms since the epoch. */
  readonly createdAt: number;
}

/**
 * The key of one field of a style.
 *
 * @param styleId - The style.
 * @param field - The field.
 * @returns `<styleId>.<field>`.
 */
export function styleKey(styleId: string, field: StyleField): string {
  return `${styleId}.${field}`;
}

/** A key of a styles map, split. */
export interface ParsedStyleKey {
  /** The style's id. */
  readonly styleId: StyleId;
  /** Which of its keys. */
  readonly field: StyleField;
}

/**
 * Splits a key of a styles map.
 *
 * @param key - A key, as any peer may have written it.
 * @returns The style id and field, or `undefined` for a key of no style field.
 */
export function parseStyleKey(key: string): ParsedStyleKey | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  const styleId = key.slice(0, dot);
  const field = key.slice(dot + 1);
  if (!styleIdSchema.safeParse(styleId).success) return undefined;
  if (!(STYLE_FIELDS as readonly string[]).includes(field)) return undefined;
  return { styleId, field: field as StyleField };
}

/**
 * Tells whether a value is a plain record (not a shared type, not an array).
 *
 * @param value - Anything.
 * @returns True for a plain record.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Y.AbstractType)
  );
}

/**
 * Tells whether a value is a style's identity (the door's rule): exactly `{ createdBy,
 * createdAt }`, `createdBy` a principal or `null`, `createdAt` a finite number.
 *
 * @param value - The stored value.
 * @returns True for a style identity.
 */
export function isStyleIdentity(value: unknown): value is StyleIdentity {
  if (!isRecord(value)) return false;
  if (Object.keys(value).length !== 2) return false;
  const { createdBy, createdAt } = value;
  return (
    (createdBy === null || principalIdSchema.safeParse(createdBy).success) &&
    typeof createdAt === 'number' &&
    Number.isFinite(createdAt)
  );
}

/**
 * Tells whether a value is a style name the door and the store accept.
 *
 * @param value - The value.
 * @returns True for a valid style name.
 */
export function isStyleName(value: unknown): value is string {
  return styleNameSchema.safeParse(value).success;
}

/**
 * Tells whether a value is a style value of a kind the door and the store accept.
 *
 * @param kind - The style's kind.
 * @param value - The value.
 * @returns True for a valid value.
 */
export function isStyleValue(kind: StyleKind, value: unknown): boolean {
  const schema = kind === 'text' ? textStyleValueSchema : effectStyleValueSchema;
  return schema.safeParse(value).success;
}

/**
 * Reads one style's entry from its map, when its identity, name and value are readable.
 *
 * @param map - The kind's map.
 * @param kind - The kind.
 * @param styleId - The style.
 * @returns The entry, frozen, or `undefined`.
 */
export function readStyle<Kind extends StyleKind>(
  map: Y.Map<unknown>,
  kind: Kind,
  styleId: string,
): StyleEntry<Kind> | undefined {
  const identity = map.get(styleKey(styleId, 'identity'));
  if (!isStyleIdentity(identity)) return undefined;
  const name = map.get(styleKey(styleId, 'name'));
  const value = map.get(styleKey(styleId, 'value'));
  if (!isStyleName(name) || !isStyleValue(kind, value)) return undefined;
  return Object.freeze({
    id: styleId,
    name,
    value: structuredClone(value),
    createdBy: identity.createdBy,
    createdAt: identity.createdAt,
  }) as StyleEntry<Kind>;
}

/**
 * Reads a kind's table: every readable style, sorted by id.
 *
 * @param map - The kind's map.
 * @param kind - The kind.
 * @returns The entries by id.
 */
export function readStyles<Kind extends StyleKind>(
  map: Y.Map<unknown>,
  kind: Kind,
): Map<StyleId, StyleEntry<Kind>> {
  const ids: string[] = [];
  for (const key of map.keys()) {
    const parsed = parseStyleKey(key);
    if (parsed?.field === 'identity') ids.push(parsed.styleId);
  }
  const entries = new Map<StyleId, StyleEntry<Kind>>();
  for (const id of ids.sort()) {
    const entry = readStyle(map, kind, id);
    if (entry !== undefined) entries.set(id, entry);
  }
  return entries;
}

/**
 * Writes one key unless it already holds the same value.
 *
 * @param map - The map.
 * @param key - The key.
 * @param value - The value.
 */
function writeKey(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (map.has(key) && isSamePlainValue(map.get(key), value)) return;
  map.set(key, structuredClone(value));
}

/**
 * Writes a style: creates its identity when it is not stored, then its name and value where they
 * differ.
 *
 * @param map - The kind's map, inside a transaction.
 * @param kind - The kind.
 * @param style - The style as it should read.
 * @param creation - Who creates it, for a new entry's identity.
 * @throws {DocumentWriteError} When the style's id, name or value is invalid.
 */
export function writeStyle(
  map: Y.Map<unknown>,
  kind: StyleKind,
  style: StyleWrite,
  creation: StyleCreation,
): void {
  const valueSchema = kind === 'text' ? textStyleValueSchema : effectStyleValueSchema;
  const issues = [
    ...(styleIdSchema.safeParse(style.id).error?.issues ?? []),
    ...(styleNameSchema.safeParse(style.name).error?.issues ?? []),
    ...(valueSchema.safeParse(style.value).error?.issues ?? []),
  ];
  if (issues.length > 0) throw new DocumentWriteError(style.id, issues);
  const identityKey = styleKey(style.id, 'identity');
  if (!isStyleIdentity(map.get(identityKey))) {
    const identity: StyleIdentity = {
      createdBy: creation.createdBy,
      createdAt: creation.createdAt,
    };
    map.set(identityKey, { ...identity });
  }
  writeKey(map, styleKey(style.id, 'name'), style.name);
  writeKey(map, styleKey(style.id, 'value'), style.value);
}

/**
 * Deletes a style's keys.
 *
 * @param map - The kind's map, inside a transaction.
 * @param styleId - The style.
 * @returns True when a key was deleted.
 */
export function eraseStyle(map: Y.Map<unknown>, styleId: StyleId): boolean {
  let isErased = false;
  for (const field of STYLE_FIELDS) {
    const key = styleKey(styleId, field);
    if (!map.has(key)) continue;
    map.delete(key);
    isErased = true;
  }
  return isErased;
}
