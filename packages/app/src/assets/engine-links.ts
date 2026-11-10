import type { AdapterAssetMessage, PageLink } from './asset-channel.js';

/**
 * The links of the engines the page's images were connected to (`PageImages.connect`), one
 * current. A newer engine's link parks the one before rather than closing it (the History
 * preview borrows the live board's images while the live engine stays mounted), and
 * releasing the current link (its engine was destroyed) makes the last parked one current
 * again. Only the current link is listened to and sent to. Main thread.
 */
export class EngineLinks {
  private link: PageLink | undefined;
  private stopListening: (() => void) | undefined;
  private readonly parked: PageLink[] = [];

  /**
   * Starts with no link.
   *
   * @param onMessage - Receives the current link's messages.
   * @param onCurrent - Told when a link becomes current: a new one, or a parked one restored
   *   (which missed what was sent meanwhile).
   */
  constructor(
    private readonly onMessage: (message: AdapterAssetMessage) => void,
    private readonly onCurrent: (link: PageLink, isRestored: boolean) => void,
  ) {}

  /**
   * The link sent to now.
   *
   * @returns It, or undefined without one.
   */
  get current(): PageLink | undefined {
    return this.link;
  }

  /**
   * Makes a link current, parking the one before.
   *
   * @param link - The page's end of the new engine's link.
   * @returns Releases it: closes it and, if it was current, restores the last parked link.
   */
  connect(link: PageLink): () => void {
    if (this.link !== undefined) this.parked.push(this.link);
    this.use(link, false);
    return () => {
      this.release(link);
    };
  }

  /** Closes every link, the parked ones included. */
  closeAll(): void {
    this.stopListening?.();
    this.link?.close();
    for (const link of this.parked.splice(0)) link.close();
    this.link = undefined;
    this.stopListening = undefined;
  }

  /**
   * Closes a link; when it was current, the last parked link becomes current again.
   *
   * @param link - The link.
   */
  private release(link: PageLink): void {
    const index = this.parked.indexOf(link);
    if (index !== -1) {
      this.parked.splice(index, 1);
      link.close();
      return;
    }
    if (this.link !== link) return;
    this.stopListening?.();
    link.close();
    this.link = undefined;
    this.stopListening = undefined;
    const restored = this.parked.pop();
    if (restored !== undefined) this.use(restored, true);
  }

  /**
   * Listens to a link and sends to it from now on.
   *
   * @param link - The link.
   * @param isRestored - Whether it was parked.
   */
  private use(link: PageLink, isRestored: boolean): void {
    this.stopListening?.();
    this.link = link;
    this.stopListening = link.listen(this.onMessage);
    this.onCurrent(link, isRestored);
  }
}
