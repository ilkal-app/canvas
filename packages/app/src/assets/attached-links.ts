import type { PageAssetMessage, PageLink } from './asset-channel.js';

/** What the attached links need of the page's images. */
export interface AttachedLinksPage {
  /**
   * Answers an attached link's request for access.
   *
   * @param link - The link that asked.
   * @param isRepeated - Whether it asked before (its next token is a fresh one).
   */
  answer(link: PageLink, isRepeated: boolean): void;
  /**
   * Whether the adapters should pause: the page is hidden, or the session ended.
   *
   * @returns Whether they should.
   */
  isHidden(): boolean;
  /**
   * Whether the board's session ended.
   *
   * @returns Whether it did.
   */
  isEnded(): boolean;
}

/**
 * The links of engines beside the page's own (an export's capture): each answered when
 * it asks for access, told the page's visibility as it attaches and the session's end, and
 * closed when detached or when the page's images go. Main thread.
 */
export class AttachedLinks {
  private readonly links = new Set<PageLink>();
  /** The links that have asked for access before. */
  private readonly askers = new Set<PageLink>();

  /**
   * Starts with no link.
   *
   * @param page - The page's images.
   */
  constructor(private readonly page: AttachedLinksPage) {}

  /**
   * Talks to another engine's adapter over a link (`PageImages.attach`).
   *
   * @param link - The page's end of the link.
   * @returns Stops answering and closes the link.
   */
  attach(link: PageLink): () => void {
    this.links.add(link);
    const stop = link.listen((message) => {
      if (message.type !== 'access-request' || this.page.isEnded()) return;
      const isRepeated = this.askers.has(link);
      this.askers.add(link);
      this.page.answer(link, isRepeated);
    });
    link.send({ type: 'page-visibility', isHidden: this.page.isHidden() });
    if (this.page.isEnded()) link.send({ type: 'session-ended' });
    return () => {
      if (!this.links.delete(link)) return;
      stop();
      link.close();
    };
  }

  /**
   * Tells every attached link a message.
   *
   * @param message - The message.
   */
  send(message: PageAssetMessage): void {
    for (const link of this.links) link.send(message);
  }

  /** Closes every attached link. */
  closeAll(): void {
    for (const link of this.links) link.close();
    this.links.clear();
  }
}
