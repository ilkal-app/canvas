import { NO_STICKY_AUTHORS, type StickyAuthors } from '@canvas/engine';

import type { BoardMembers } from '../service/board-people.js';

/** The name of a sticky's author no longer on the board. */
const FORMER_MEMBER = 'Former member';

/**
 * Each board member's and agent's display name by the principal id a sticky records as its
 * author: `user:<userId>` and `agent:agent-key:<keyId>`. A member with no name is left
 * out, so their stickies show the fallback. A connected app's principal (`agent:connect:<id>`)
 * is not in the member list, so its stickies show the fallback too (scope: agent keys).
 *
 * @param members - The board's members and agents.
 * @returns The names by principal id.
 */
export function stickyAuthorNamesOf(members: BoardMembers): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const { userId, name } of members.members) {
    const trimmed = name.trim();
    if (trimmed.length > 0) names.set(`user:${userId}`, trimmed);
  }
  for (const { keyId, name } of members.agents) {
    const trimmed = name.trim();
    if (trimmed.length > 0) names.set(`agent:agent-key:${keyId}`, trimmed);
  }
  return names;
}

/**
 * The sticky authors the engine draws: the board's setting with the members' names and
 * "Former member" for anyone else. Without the member list (a local board, or a request that
 * failed or was refused) nothing is drawn, whatever the setting: no names for someone who cannot
 * read who is on the board, and no "Former member" on every sticky.
 *
 * @param isShown - The board's "Show authors on stickies" setting.
 * @param members - The board's members, when the person could read them.
 * @returns The authors.
 */
export function stickyAuthorsOf(
  isShown: boolean,
  members: BoardMembers | undefined,
): StickyAuthors {
  if (members === undefined) return NO_STICKY_AUTHORS;
  return stickyAuthorsFrom(isShown, stickyAuthorNamesOf(members));
}

/**
 * The sticky authors from the board's setting and names already read from its members.
 *
 * @param isShown - The board's "Show authors on stickies" setting.
 * @param names - The members' names by principal id (`stickyAuthorNamesOf`).
 * @returns The authors, "Former member" for anyone else.
 */
export function stickyAuthorsFrom(
  isShown: boolean,
  names: ReadonlyMap<string, string>,
): StickyAuthors {
  return { isShown, names, fallback: FORMER_MEMBER };
}
