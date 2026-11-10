import type { BoardTokenClaims } from '@canvas/collab';
import { parseTransactionOrigin, type TransactionOrigin } from '@canvas/document';

/**
 * The command origin of the person a board token names: `user:<sub>`,
 * or a guest's `guest:<sub>`,
 * the principal the relay attributes the connection's updates to, so the document's
 * `createdBy`, the change sets and the undo history agree with the relay's log. The shell is
 * for people; agents join through `@canvas/headless`.
 *
 * @param claims - The token's claims.
 * @returns The origin, frozen.
 * @throws {RangeError} When the token names an agent, or a subject that is not a bare id.
 */
export function userOriginFromClaims(claims: BoardTokenClaims): TransactionOrigin {
  if (claims.principalType === 'agent') {
    throw new RangeError(`The shell opens boards for people; the token names an agent.`);
  }
  if (claims.principalId.includes(':')) {
    throw new RangeError(`A token's subject is a bare id, got "${claims.principalId}".`);
  }
  // A guest edits as a person does, under its own `guest:<id>` principal.
  return parseTransactionOrigin({
    kind: 'user',
    principalId: `${claims.principalType}:${claims.principalId}`,
  });
}
