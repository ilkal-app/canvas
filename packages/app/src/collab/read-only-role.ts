import type { BoardTokenRole } from '@canvas/collab';

/**
 * Whether a board token's role may only look at the board: a viewer, or a commenter,
 * who is treated as a viewer for editing until comments exist. The relay decides the same way
 * (it answers `readonly` to both), and the collab client runs a viewer's store in read-only
 * repair mode. Pure.
 *
 * @param role - The token's role.
 * @returns True for a viewer or a commenter.
 */
export function isReadOnlyRole(role: BoardTokenRole): boolean {
  return role === 'viewer' || role === 'commenter';
}
