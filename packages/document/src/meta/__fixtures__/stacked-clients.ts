// An update that stacks one struct per client: what an editor can send to make Yjs's
// integration, and the stamp check's replay of it, set aside a stack as long as the update.
import { encodeHandUpdate, type HandBlock } from './hand-encoded-update.js';

/** The first client id of the chain; the client below it sends nothing. */
const FIRST_CLIENT = 1;

/**
 * About 1 MiB of the review's hostile update: 10 to 11 bytes per client (its block header, one
 * deleted item and its right neighbour), so 95,000 clients fill 1,011,982 bytes.
 */
export const STACKED_CLIENTS_PER_MIB = 95_000;

/**
 * An update of `clientCount` clients, one deleted item each, whose right neighbour is the item
 * of the client below it; the lowest names a client that sends nothing. Yjs takes the highest
 * client first, follows the chain down through every client, and finds the last neighbour
 * missing: every item is stacked, then set aside (`addStackToRestSS`).
 *
 * @param clientCount - How many clients (and stacked items).
 * @returns The update's bytes (format v1).
 */
export function stackedClientsUpdate(clientCount: number): Uint8Array {
  const blocks: HandBlock[] = [];
  for (let offset = clientCount - 1; offset >= 0; offset -= 1) {
    const client = FIRST_CLIENT + offset;
    blocks.push({
      client,
      clock: 0,
      structs: [
        { rightOrigin: { client: client - 1, clock: 0 }, content: { kind: 'deleted', length: 1 } },
      ],
    });
  }
  return encodeHandUpdate(blocks);
}

/**
 * An honest board's state of `clientCount` clients, each of which appended one value to the
 * list `notes` after the one before it (what Yjs encodes for such a board). Yjs takes the
 * highest client first and follows the chain down too, but the lowest item names its list, so
 * the whole stack integrates and nothing is set aside.
 *
 * @param clientCount - How many clients wrote.
 * @returns The state's bytes (format v1).
 */
export function appendedByClientsBoard(clientCount: number): Uint8Array {
  const blocks: HandBlock[] = [];
  for (let offset = clientCount - 1; offset >= 0; offset -= 1) {
    const client = FIRST_CLIENT + offset;
    const content = { kind: 'any', values: [client] } as const;
    const item =
      offset === 0
        ? { parent: 'notes', content }
        : { origin: { client: client - 1, clock: 0 }, content };
    blocks.push({ client, clock: 0, structs: [item] });
  }
  return encodeHandUpdate(blocks);
}
