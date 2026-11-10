import type { RepairMode } from '@canvas/document';

import type { BoardTokenClaims } from './board-token.js';

/**
 * Selects repair authority from the token and the relay's authenticated write decision.
 *
 * @param claims - Claims identifying the actor and role.
 * @param isReadOnly - Relay decision; defaults to the token's role before authentication.
 * @returns Full human repair, legacy-only agent repair, or projection without writes.
 */
export function repairModeFor(
  claims: BoardTokenClaims,
  isReadOnly = claims.role === 'viewer' || claims.role === 'commenter',
): RepairMode {
  return isReadOnly ? 'read-only' : claims.principalType === 'agent' ? 'agent-write' : 'write';
}
