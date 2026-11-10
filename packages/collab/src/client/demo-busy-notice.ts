// A demo board's relay refused its visitor for now: the relay admits only so many demo
// visitors' connections to a board, and closes the next with 1013 `demo-busy`.

/** The reason of the relay's close of a demo visitor past the board's demo limits (1013). */
export const DEMO_BUSY_REASON = 'demo-busy';

/**
 * Reported (`onError`) when the relay closed the connection with `demo-busy`: too many
 * visitors on the public demo board for now. A notice: the client retries as for any lost
 * connection, and the page may tell the visitor instead and stop.
 */
export class DemoBusyNotice extends Error {
  /** Creates the notice. */
  constructor() {
    super('The relay admits no more demo board visitors for now (1013 demo-busy).');
    this.name = 'DemoBusyNotice';
  }
}
