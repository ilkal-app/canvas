import { AssetsHttp, type AssetAccess, type AssetsFetch } from './assets-http.js';
import { NO_IMAGES_MESSAGE } from './page-images-messages.js';
import type { BoardImageAccess } from './page-images-types.js';

const ENDED_MESSAGE = 'The session ended: no token is asked for.';

/**
 * The board's tokens for the assets service, as the page's images hold them (`PageImages`): the
 * one held, a fresh one fetched once for every refusal meanwhile, and the client that sends it.
 * Nothing is asked for, kept or given once the session ended. Main thread.
 */
export class BoardTokens {
  private token: Promise<string> | undefined;
  /** A fresh token being fetched, which every refusal meanwhile waits for. */
  private freshToken: Promise<string> | undefined;
  /** The token held now; empty before the first is fetched (such a request is refused). */
  private heldToken = '';
  /**
   * Whether the token held was fetched only for attached links and used by nothing else since,
   * so the connected engine's first ask is not taken for a repeat.
   */
  private isOnlyAttached = false;

  /**
   * Holds no token yet.
   *
   * @param access - The board's assets and tokens, or undefined without an assets service.
   * @param fetch - The client's `fetch`; the platform's if absent.
   * @param hasEnded - Whether the board's session ended, read afresh after an await.
   */
  constructor(
    private readonly access: BoardImageAccess | undefined,
    private readonly fetch: AssetsFetch | undefined,
    private readonly hasEnded: () => boolean,
  ) {}

  /**
   * The client for the board with the token held (fetched on first use).
   *
   * @returns The client.
   * @throws {Error} When the page has no assets service, or the session ended.
   */
  http(): AssetsHttp {
    const access = this.access;
    // No request once the session ended, whichever step was waiting for it.
    if (access === undefined || this.hasEnded()) throw new Error(NO_IMAGES_MESSAGE);
    return new AssetsHttp({ ...access, token: this.heldToken }, this.fetch);
  }

  /**
   * Fetches a fresh token and holds it.
   *
   * @returns Settles once held.
   */
  async refresh(): Promise<void> {
    await this.current(true);
  }

  /**
   * The board's access with a token: the held one, or a fresh one.
   *
   * @param isFresh - Whether to fetch a new token.
   * @param isForAttached - Whether an attached link asked; anything else that uses a
   *   token (an upload, a link, the connected engine) counts as the page's own use.
   * @returns The access, or null without an assets service.
   * @throws {Error} Once the session ended.
   */
  async current(isFresh: boolean, isForAttached = false): Promise<AssetAccess | null> {
    const { access } = this;
    if (access === undefined) return null;
    if (!isForAttached) this.isOnlyAttached = false;
    else if (this.token === undefined) this.isOnlyAttached = true;
    if (this.hasEnded()) throw new Error(ENDED_MESSAGE);
    if (isFresh) {
      // Refusals that arrive together (several uploads, the adapter) share one fetch.
      this.freshToken ??= access.token(true).finally(() => {
        this.freshToken = undefined;
      });
      this.token = this.freshToken;
    } else this.token ??= access.token(false);
    const token = await this.token;
    // Asked for before the session ended, answered after: neither kept nor given.
    if (this.hasEnded()) throw new Error(ENDED_MESSAGE);
    this.heldToken = token;
    return { assetsUrl: access.assetsUrl, boardId: access.boardId, token: this.heldToken };
  }

  /**
   * The access an adapter asked for: a fresh token after the first ask (the adapter asks again
   * when one was refused). The connected engine's asks repeat once any token is held, unless it
   * was fetched only for attached links; an attached link's when it asked before. A
   * token that cannot be fetched is given empty, so the adapter's requests are refused and it
   * asks again, rather than waiting for good.
   *
   * @param hasAttachedAsked - For an attached link, whether it asked before; undefined for the
   *   connected engine.
   * @returns The access (null without an assets service), or undefined once the session ended.
   */
  async answer(hasAttachedAsked?: boolean): Promise<AssetAccess | null | undefined> {
    const isRepeated = hasAttachedAsked ?? (this.token !== undefined && !this.isOnlyAttached);
    const access = await this.current(isRepeated, hasAttachedAsked !== undefined).catch(() => {
      const { assetsUrl, boardId } = this.access ?? { assetsUrl: '', boardId: '' };
      return { assetsUrl, boardId, token: '' };
    });
    // The session ended meanwhile: no access is handed out.
    return this.hasEnded() ? undefined : access;
  }
}
