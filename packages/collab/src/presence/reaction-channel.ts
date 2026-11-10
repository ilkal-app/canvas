import { encodeReactionDrop, type ReactionDrop, type ReactionEvent } from '@canvas/schema';

// Reactions: a person drops an emoji and everyone else on the board sees it float up
// and fade. Not presence state and not board content: an event, sent once through the relay,
// which stamps the sender and fans it out to the board's other connections (never back), and
// never stored. The channel outlives connections: each authenticated connection is its way out
// while it is current, and its way in for everyone else's.

/** Sends a stateless payload on the current connection; false when there is none. */
export type ReactionSender = (payload: string) => boolean;

/**
 * A client's reactions, handed to the client as `CollabClientOptions.reactions`: the app
 * sends its person's drops and hears everyone else's.
 */
export class ReactionChannel {
  readonly #listeners = new Set<(event: ReactionEvent) => void>();
  #sender: ReactionSender | undefined;

  /**
   * Sends a drop to everyone else on the board, on the current connection.
   *
   * @param drop - The drop.
   * @returns Whether it went: false with no authenticated connection (offline, connecting).
   * @throws {RangeError} When the drop breaks the wire's rules (`encodeReactionDrop`).
   */
  send(drop: ReactionDrop): boolean {
    const payload = encodeReactionDrop(drop);
    return this.#sender?.(payload) ?? false;
  }

  /**
   * Listens for everyone else's reactions.
   *
   * @param listener - Called with each reaction the relay fans out to this client.
   * @returns A function that stops listening.
   */
  subscribe(listener: (event: ReactionEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Makes a connection the channel's way out, in place of any earlier one. Package-internal: the
   * relay link calls it for each connection it opens.
   *
   * @param sender - Sends on that connection while it is current and authenticated.
   */
  attach(sender: ReactionSender): void {
    this.#sender = sender;
  }

  /**
   * Hands a reaction the relay fanned out to the listeners. Package-internal: the connection
   * calls it. A listener that throws does not stop the others; the first error is rethrown.
   *
   * @param event - The reaction.
   * @throws {unknown} The first error a listener threw.
   */
  receive(event: ReactionEvent): void {
    const errors: unknown[] = [];
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw errors[0];
  }
}
