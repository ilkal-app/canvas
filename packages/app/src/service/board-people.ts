// The people of a board as the boards service answers them (its members route): who is
// on it and with which role, its agent keys, and for the owner its invitations and share link.
// The shell's comments and stickies read them; the site's API types re-export them.

/** A person the service knows: the signed-in person, or anyone a board shows. */
export interface Person {
  /** The service's id for them. */
  readonly id: string;
  /** Their verified email address. */
  readonly email: string;
  /** Their name as the identity provider gives it; may be empty. */
  readonly name: string;
  /** Their picture's URL, if any. */
  readonly pictureUrl: string | null;
}

/**
 * A person's role on a board. A `commenter` reads the board and writes comments; the
 * relay keeps their connection read-only on the document.
 */
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';

/** A role that can be given to someone else: an invitation's or the share link's. */
export type SharedRole = Exclude<Role, 'owner'>;

/** A person on a board. */
export interface Member {
  /** Their user id. */
  readonly userId: string;
  /** Their name. */
  readonly name: string;
  /** Their email address. */
  readonly email: string;
  /** Their picture's URL, if any. */
  readonly pictureUrl: string | null;
  /** Their role. */
  readonly role: Role;
  /** When they were added. */
  readonly addedAt: string;
}

/** An agent key of a board, as the members answer shows it. */
export interface BoardAgent {
  /** The key's id. */
  readonly keyId: string;
  /** Its name, as its operator gave it. */
  readonly name: string;
  /** The role it acts with now: its operator's, or `viewer` while agents cannot edit. */
  readonly role: Role;
  /** Its operator's user id; absent from a service older than that. */
  readonly operatorId?: string;
  /** Its operator's name, possibly empty; absent from a service older than that. */
  readonly operatorName?: string;
}

/** An invitation not yet accepted. */
export interface Invitation {
  /** Its id. */
  readonly id: string;
  /** The address it was sent to. */
  readonly email: string;
  /** The role it gives. */
  readonly role: SharedRole;
  /** When it was sent. */
  readonly createdAt: string;
  /** When it stops working (7 days after it was sent). */
  readonly expiresAt: string;
}

/** A board's share link. */
export interface ShareLink {
  /** The role it gives. */
  readonly role: SharedRole;
  /** Whether it works. */
  readonly isOn: boolean;
  /** When its secret was last replaced. */
  readonly replacedAt: string;
}

/** `GET /api/boards/:id/members`: the people, and for the owner the invitations and link. */
export interface BoardMembers {
  /** The people on the board. */
  readonly members: readonly Member[];
  /** The board's agent keys, with the role each acts with now. */
  readonly agents: readonly BoardAgent[];
  /** Pending invitations (the owner only). */
  readonly invitations?: readonly Invitation[];
  /** The share link (the owner only). */
  readonly link?: ShareLink;
}
