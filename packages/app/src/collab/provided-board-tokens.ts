import type { BoardTokenProvider } from '@canvas/collab';

/**
 * Board tokens from a source of the page's own (the site's boards service) instead of the
 * address's token or token endpoint, with the name presence shows for the person.
 */
export interface ProvidedBoardTokens {
  /** This board's token for the relay and the assets service. */
  readonly getToken: BoardTokenProvider;
  /**
   * A token the assets service has not refused: the provider forgets the one it held first.
   *
   * @returns The token.
   */
  readonly freshToken: () => Promise<string>;
  /**
   * A token for another board, for an image pasted from it; undefined where the person has
   * none.
   *
   * @param boardId - The other board.
   * @returns The token, or undefined.
   */
  readonly tokenFor: (boardId: string) => Promise<string | undefined>;
  /** The name presence shows the others for this person, already made safe to show. */
  readonly presenceName: string;
}
