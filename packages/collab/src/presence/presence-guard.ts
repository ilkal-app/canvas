import { isPageIdText } from '@canvas/schema';

import { MAX_PRESENCE_TEXT_LENGTH } from './presence-limits.js';
import { PRINCIPAL_KINDS } from './presence-state.js';
import type { PresencePrincipal, PresenceState } from './presence-state.js';
import {
  isRecord,
  isValidCursor,
  isValidEditing,
  isSelectionList,
  isValidViewport,
} from './presence-validation.js';

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isPrincipalKind(value: unknown): boolean {
  return PRINCIPAL_KINDS.some((kind) => kind === value);
}

/**
 * Whether a value is a presence principal: a non-empty id, a known kind, a name and a
 * `#rrggbb` colour, the id at most `MAX_PRESENCE_TEXT_LENGTH` long. Any name passes: the channel
 * shortens and cleans it (`cleanPresenceName`) rather than losing the collaborator.
 *
 * @param value - Any value, typically a remote client's `principal` field.
 * @returns True when `value` is a {@link PresencePrincipal}.
 */
export function isPresencePrincipal(value: unknown): value is PresencePrincipal {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= MAX_PRESENCE_TEXT_LENGTH &&
    isPrincipalKind(value.kind) &&
    typeof value.name === 'string' &&
    typeof value.color === 'string' &&
    COLOR_PATTERN.test(value.color)
  );
}

/**
 * Whether a remote awareness state is presence this package can show. Awareness carries
 * whatever JSON a peer sent, and a fresh awareness instance starts with `{}`, so every remote
 * state passes through this guard before it reaches a snapshot; states that fail it are left
 * out rather than repaired. A state that passes is then cleaned (`sanitizePresenceState`): the
 * name shortened, the selection filtered, the editing claim rebuilt from its own
 * three fields.
 *
 * @param value - A remote client's awareness state.
 * @returns True when `value` is a {@link PresenceState}.
 */
export function isPresenceState(value: unknown): value is PresenceState {
  return (
    isRecord(value) &&
    isPresencePrincipal(value.principal) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    (value.cursor === undefined || isValidCursor(value.cursor)) &&
    (value.selection === undefined || isSelectionList(value.selection)) &&
    (value.viewport === undefined || isValidViewport(value.viewport)) &&
    (value.page === undefined || isPageIdText(value.page)) &&
    (value.editing === undefined || isValidEditing(value.editing))
  );
}
