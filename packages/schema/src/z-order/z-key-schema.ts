import { z } from 'zod';

import type { BoardIssueCode } from '../rules/board-issue.js';

import { isValidKey, KEY_CHARACTERS, MAX_KEY_LENGTH } from './key-rule.js';

/** The board issue code `importBoard` reports an invalid `z` under. */
const boardIssueCode: BoardIssueCode = 'invalid-z-key';

/**
 * Validates a `z` value by the fractional-index key rule ({@link isValidKey}) in one refinement,
 * so an invalid key yields exactly one issue, and that issue carries
 * `params.boardIssueCode: 'invalid-z-key'`, which `importBoard` reports it under. The length
 * cap and the character set are also stated as metadata, so the JSON Schema agents read carries
 * `maxLength` and `pattern`.
 */
export const zKeySchema = z
  .string()
  .refine(isValidKey, {
    message: `z must be a fractional-index key: 1 to ${String(MAX_KEY_LENGTH)} base-62 characters (0-9, A-Z, a-z), a head letter, the integer digits it states, and a fraction not ending in 0`,
    params: { boardIssueCode },
  })
  .meta({ maxLength: MAX_KEY_LENGTH, pattern: KEY_CHARACTERS.source });
