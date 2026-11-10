/**
 * The most UTF-16 units a principal's id may have, and the most a display name keeps. Awareness
 * carries whatever a peer sent, and the name is drawn beside its cursor and joined into the
 * connection chip's tooltip on every client, viewers included, so an unbounded one is a message
 * to everyone. A peer whose id is past it is left out like any other state the guard refuses; a
 * name past it is shortened (`presence-names.ts`), so the collaborator stays visible.
 * Package-internal.
 */
export const MAX_PRESENCE_TEXT_LENGTH = 256;

/**
 * The most UTF-16 units a selected object id may have in presence: an object id is 1 to 64
 * letters, digits, `_` or `-` (`@canvas/schema`). Package-internal.
 */
export const MAX_PRESENCE_ID_LENGTH = 64;

/**
 * The most ids a shared selection lists; a client that selects more shares the first ones. A
 * select-all on a 50,000-object board would otherwise put a megabyte in every awareness update.
 * Package-internal.
 */
export const MAX_PRESENCE_SELECTION_LENGTH = 1000;

/**
 * The largest caret or selection offset presence carries, in UTF-16 units: far past
 * any text a board object holds, and well inside the integers every client and the relay
 * compare exactly. An editing claim past it is refused. Package-internal.
 */
export const MAX_PRESENCE_TEXT_OFFSET = 2 ** 30;

/**
 * The most writer client ids a remote state's relay-stamped `writerClientIds` keeps,
 * the relay's own bound. Package-internal.
 */
export const MAX_PRESENCE_WRITER_CLIENT_IDS = 16;
