import type * as Y from 'yjs';

import {
  isBuiltinToken,
  rgbaSchema,
  tokenIdSchema,
  tokenNameSchema,
  type PrincipalId,
  type Rgba,
  type TokenId,
} from '@canvas/schema';

import { isSamePlainValue } from '../codec/plain-value.js';
import { DocumentWriteError } from '../store/document-write-error.js';

import { isTokenIdentity, TOKEN_FIELDS, tokenKey, type TokenIdentity } from './token-map.js';

// The writes of the token commands into the tokens map, inside one transaction:
// a token's keys are written only where they differ, so a rename and a recolour of one token, or
// two people recolouring its light and dark values, merge.

/** A token as a command writes it: its id, name and values. */
export interface TokenWrite {
  /** The token id: a built-in's name or a custom id. */
  readonly id: TokenId;
  /** Its name; ignored for a built-in, whose name is its id. */
  readonly name: string;
  /** The light mode's value. */
  readonly light: Rgba;
  /** The dark mode's value. */
  readonly dark: Rgba;
}

/** Who creates a token entry, and when: what its `.identity` key records. */
export interface TokenCreation {
  /** The principal of the command. */
  readonly createdBy: PrincipalId;
  /** The command's time, ms since the epoch. */
  readonly createdAt: number;
}

/**
 * Validates a token about to be written.
 *
 * @param token - The token.
 * @throws {DocumentWriteError} When its id, name or a value is invalid.
 */
function checkToken(token: TokenWrite): void {
  const issues = [
    ...(tokenIdSchema.safeParse(token.id).error?.issues ?? []),
    ...(isBuiltinToken(token.id)
      ? []
      : (tokenNameSchema.safeParse(token.name).error?.issues ?? [])),
    ...(rgbaSchema.safeParse(token.light).error?.issues ?? []),
    ...(rgbaSchema.safeParse(token.dark).error?.issues ?? []),
  ];
  if (issues.length > 0) throw new DocumentWriteError(token.id, issues);
}

/**
 * Writes one key unless it already holds the same value.
 *
 * @param map - The tokens map.
 * @param key - The key.
 * @param value - The value.
 */
function writeKey(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (map.has(key) && isSamePlainValue(map.get(key), value)) return;
  map.set(key, structuredClone(value));
}

/**
 * Writes a token: creates its identity when it is not stored (a built-in's with
 * `builtin: true` and no name key), then its name and values where they differ.
 *
 * @param map - The tokens map, inside a transaction.
 * @param token - The token as it should read.
 * @param creation - Who creates it, for a new entry's identity.
 * @throws {DocumentWriteError} When the token is invalid.
 */
export function writeToken(map: Y.Map<unknown>, token: TokenWrite, creation: TokenCreation): void {
  checkToken(token);
  const isBuiltin = isBuiltinToken(token.id);
  const identityKey = tokenKey(token.id, 'identity');
  if (!isTokenIdentity(map.get(identityKey), token.id)) {
    const identity: TokenIdentity = {
      builtin: isBuiltin,
      createdBy: creation.createdBy,
      createdAt: creation.createdAt,
    };
    map.set(identityKey, { ...identity });
  }
  if (!isBuiltin) writeKey(map, tokenKey(token.id, 'name'), token.name);
  writeKey(map, tokenKey(token.id, 'light'), [...token.light]);
  writeKey(map, tokenKey(token.id, 'dark'), [...token.dark]);
}

/**
 * Deletes a token's keys: a custom token's delete, or a built-in's reset to its defaults.
 *
 * @param map - The tokens map, inside a transaction.
 * @param tokenId - The token.
 * @returns True when a key was deleted.
 */
export function eraseToken(map: Y.Map<unknown>, tokenId: TokenId): boolean {
  let isErased = false;
  for (const field of TOKEN_FIELDS) {
    const key = tokenKey(tokenId, field);
    if (!map.has(key)) continue;
    map.delete(key);
    isErased = true;
  }
  return isErased;
}
