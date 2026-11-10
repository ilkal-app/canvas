import { normalizeLink } from '../fields/link.js';

import type { PaintValueFinding } from './paint-values.js';

// The door's judgement of an object's link: the `link` member of a `style` value a peer
// writes, judged as the schema would accept it, from a value that may be anything, so a hostile
// peer cannot store a `javascript:` link that another client would open. Pure.

/**
 * The door's judgement of a text's, sticky's or image's link as a peer wrote it:
 * absent, or a string that `normalizeLink` leaves unchanged (an http, https or mailto URL,
 * without a user name or password, at most `LINK_MAX_LENGTH`). Anything else is refused as
 * `out-of-range`. Pure.
 *
 * @param value - The value as written, from any peer; not mutated.
 * @returns The finding (field `''`), or undefined when acceptable.
 */
export function linkValueReason(value: unknown): PaintValueFinding | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && normalizeLink(value) === value) return undefined;
  return { field: '', reason: 'out-of-range' };
}
