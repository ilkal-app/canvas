import { readScannedPlainValue } from '../assets/scanned-value.js';
import type { ScannedItem } from '../assets/update-scan.js';
import { isTokenIdentity, isTokenName, isTokenValue, parseTokenKey } from '../tokens/token-map.js';

import type { HostileValue } from './field-values.js';

// The relay's door check of writes into the colour tokens map: judged
// by key shape, as the pages map is (`page-values.ts`). `<id>.identity` holds exactly
// `{ builtin, createdBy, createdAt }` with `builtin` true exactly for a built-in's id, `<id>.name`
// a name of 1 to 40 characters, `<id>.light` and `<id>.dark` a colour tuple in [0, 1]; any other
// key or value is refused (4426 `update-malformed`, `hostile-values`). The door never counts
// tokens (the limit is a creation limit), and who may write which token is the relay's agent
// check (`agent-permissions.ts`), not the door's. Package-internal.

/** A value an update writes into the tokens map. */
export interface TokenMapWrite {
  /** The value's item in the update. */
  readonly item: ScannedItem;
  /** Its key in the tokens map. */
  readonly key: string;
}

/**
 * Judges one write into the tokens map.
 *
 * @param update - The update's bytes.
 * @param write - The write.
 * @returns Why it is refused, or undefined.
 */
function tokenFinding(
  update: Uint8Array,
  write: TokenMapWrite,
): HostileValue['reason'] | undefined {
  const parsed = parseTokenKey(write.key);
  if (parsed === undefined) return 'not-a-token-key';
  let read: { readonly value: unknown } | undefined;
  try {
    read = readScannedPlainValue(update, write.item);
  } catch {
    return 'not-a-plain-value';
  }
  if (read === undefined) return 'not-a-plain-value';
  const { value } = read;
  switch (parsed.field) {
    case 'identity':
      return isTokenIdentity(value, parsed.tokenId) ? undefined : 'not-a-token-value';
    case 'name':
      return isTokenName(value) ? undefined : 'not-a-token-value';
    default:
      return isTokenValue(value) ? undefined : 'not-a-token-value';
  }
}

/**
 * Judges the values an update writes into the colour tokens map: the first the door refuses, if
 * any. Reads each value once from the update's bytes; never reads the hub.
 *
 * @param update - The update's bytes; not mutated.
 * @param writes - The values it writes into the tokens map, where Yjs puts them.
 * @returns The first refused write, or undefined.
 */
export function judgeTokenWrites(
  update: Uint8Array,
  writes: readonly TokenMapWrite[],
): HostileValue | undefined {
  for (const write of writes) {
    const reason = tokenFinding(update, write);
    if (reason !== undefined) {
      return { objectId: '', key: write.key, field: '', reason, tokenKey: write.key };
    }
  }
  return undefined;
}
