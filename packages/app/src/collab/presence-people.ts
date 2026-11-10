import type { CollaboratorSummary } from './board-connection-status.js';

/** One avatar of the presence bar: a person or an agent on the board, once however many tabs. */
export interface PresencePerson {
  /** Their principal id, unique among the entries. */
  readonly principalId: string;
  /** Person or agent. */
  readonly kind: CollaboratorSummary['kind'];
  /** Their display name. */
  readonly name: string;
  /** Up to two letters for a person's avatar (`MI` for Mira, `AL` for Ada Lovelace). */
  readonly initials: string;
  /** Their presence colour, `#rrggbb`; an agent shows the agent colour instead. */
  readonly color: string;
  /** The name of the page they show, when known. */
  readonly pageName?: string;
}

/** The presence bar's avatars after the overflow rule: those shown and those under "+N". */
export interface PresenceOverflow {
  /** The avatars shown, in order. */
  readonly shown: readonly PresencePerson[];
  /** The rest, which the "+N" button counts and lists; empty when everyone fits. */
  readonly rest: readonly PresencePerson[];
}

/**
 * How many avatar slots the presence/share bar has: five 26 px avatars overlapping by
 * 4 px fill the 114 px its 296 px leave beside the connection state and Share. When more are
 * on the board, the last slot is the "+N".
 */
export const PRESENCE_AVATAR_SLOTS = 5;

/**
 * Up to two initials of a name, uppercase: the first letters of its first two words, or the
 * first two letters of a one-word name. Whole code points, so an emoji or an astral letter is
 * never cut in half. Pure.
 *
 * @param name - The display name.
 * @returns The initials; `?` for a name with no letters.
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  const [first = '', second] = words;
  const letters =
    second === undefined
      ? Array.from(first).slice(0, 2)
      : [first, second].flatMap((word) => Array.from(word).slice(0, 1));
  const initials = letters.join('').toLocaleUpperCase();
  return initials === '' ? '?' : initials;
}

/**
 * The people and agents on the board as the presence bar shows them: one entry per principal
 * (a person with two tabs open is one avatar), people first then agents, each group in the
 * order given (the connection sorts by principal id). Pure.
 *
 * @param collaborators - Every other client on the board (`BoardConnectionStatus.collaborators`).
 * @param pageNameOf - A page's name from its id, so each person says their page.
 * @returns The entries; a new array.
 */
export function presencePeopleOf(
  collaborators: readonly CollaboratorSummary[],
  pageNameOf?: (pageId: string) => string | undefined,
): PresencePerson[] {
  const seen = new Set<string>();
  const people: PresencePerson[] = [];
  for (const collaborator of collaborators) {
    if (seen.has(collaborator.principalId)) continue;
    seen.add(collaborator.principalId);
    people.push({
      principalId: collaborator.principalId,
      kind: collaborator.kind,
      name: collaborator.name,
      initials: initialsOf(collaborator.name),
      color: collaborator.color,
      ...pageNameField(collaborator.page, pageNameOf),
    });
  }
  return [
    ...people.filter((person) => person.kind !== 'agent'),
    ...people.filter((person) => person.kind === 'agent'),
  ];
}

/**
 * The overflow rule of the presence bar: everyone shows when they fit in the slots;
 * otherwise the last slot becomes "+N" and the first `slots - 1` show, the rest going under it.
 * Pure.
 *
 * @param people - The entries, in the order they show.
 * @param slots - How many avatars fit, the "+N" included; at least one.
 * @returns Those shown and the rest.
 */
export function splitPresence(
  people: readonly PresencePerson[],
  slots: number = PRESENCE_AVATAR_SLOTS,
): PresenceOverflow {
  const capacity = Math.max(1, Math.floor(slots));
  if (people.length <= capacity) return { shown: people, rest: [] };
  return { shown: people.slice(0, capacity - 1), rest: people.slice(capacity - 1) };
}

/**
 * The page-name field of a person, when their page and its name are known.
 *
 * @param page - Their page id, if their presence says.
 * @param pageNameOf - A page's name from its id.
 * @returns `{ pageName }`, or nothing.
 */
function pageNameField(
  page: string | undefined,
  pageNameOf: ((pageId: string) => string | undefined) | undefined,
): { readonly pageName?: string } {
  const pageName = page === undefined ? undefined : pageNameOf?.(page);
  return pageName === undefined ? {} : { pageName };
}

/**
 * The people without one principal's own entry: the signed-in person, whose other tabs
 * presence lists as another client, shows once, as the account button. Agents are kept. Pure.
 *
 * @param people - The presence bar's entries.
 * @param principalId - The person to leave out; nobody if absent.
 * @returns The entries; `people` itself when nobody is left out.
 */
export function withoutPrincipal(
  people: readonly PresencePerson[],
  principalId: string | undefined,
): readonly PresencePerson[] {
  if (principalId === undefined) return people;
  const kept = people.filter(
    (person) => person.kind !== 'user' || person.principalId !== principalId,
  );
  return kept.length === people.length ? people : kept;
}
