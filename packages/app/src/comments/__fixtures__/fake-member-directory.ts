import { ApiError } from '../../service/api-error.js';
import type { BoardMembers, Member, Person, Role } from '../../service/board-people.js';
import type { MemberDirectory } from '../comment-provider.js';

/** The signed-in person of the comment tests. */
export const FAKE_PERSON: Person = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  pictureUrl: null,
};

/**
 * A board's people for the comment tests: none known, so listing them is refused as the service
 * refuses an unknown board (`not-found`, 404), which the comments treat as no members. A test
 * that needs members spies on `listMembers`.
 */
export class FakeMemberDirectory implements MemberDirectory {
  /**
   * The board's people.
   *
   * @param boardId - The board.
   * @returns Never: a `not-found` refusal.
   */
  listMembers(boardId: string): Promise<BoardMembers> {
    return Promise.reject(new ApiError('not-found', { status: 404, cause: `no board ${boardId}` }));
  }
}

/**
 * A person on the comment tests' board.
 *
 * @param userId - Their user id.
 * @param name - Their name.
 * @param role - Their role.
 * @returns The member.
 */
export function fakeMember(userId: string, name: string, role: Role): Member {
  return {
    userId,
    name,
    email: `${userId}@example.com`,
    pictureUrl: null,
    role,
    addedAt: '2026-09-01T10:00:00.000Z',
  };
}
