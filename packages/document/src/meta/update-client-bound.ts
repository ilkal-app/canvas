import * as decoding from 'lib0/decoding';

// A bound on the Yjs clients one update may carry. Yjs sets aside the structs it
// cannot integrate yet with one pass over the clients left per stacked struct
// (`addStackToRestSS`, yjs 13.6.33), so an update whose clients' structs depend on each other in
// a chain costs it time quadratic in its clients: 0.3 s at 10,000 clients, 5.6 s at 40,000,
// measured. The relay's own replay of that integration is linear (`update-integration.ts`), but
// the relay refuses a writer's update past the bound before scanning it. Stores apply what they
// are given: an honest relay forwards nothing past the bound and nothing Yjs would set aside,
// and a whole board's state legitimately carries one client per editing session it ever had.

/**
 * The most Yjs clients one update may carry: an update-v1 lists each client's structs in one
 * block, so this bounds its blocks. The largest honest update a writer sends the relay is its
 * sync step 2 after the relay lost the board, which carries every client that ever wrote it:
 * the sync fuzz's largest configured run (64 clients × 40 steps, a new client per raw write)
 * stays under 2,700; a board gains one client per editing session. 10,000 leaves room for
 * both, and costs Yjs about 0.3 s at worst.
 */
export const MAX_UPDATE_CLIENTS = 10_000;

/**
 * Counts the client blocks of an update's structs: its first number (update format v1). Yjs
 * writes one block per client, so for any update a Yjs encoder made this is how many clients
 * it carries; a hand-made one listing a client twice counts it twice.
 *
 * @param update - Encoded update-v1 bytes; not mutated.
 * @returns The number of blocks.
 * @throws {Error} When the bytes do not start with a number (lib0's "Unexpected end of array",
 *   or an integer out of range).
 */
export function countUpdateClients(update: Uint8Array): number {
  return decoding.readVarUint(decoding.createDecoder(update));
}
