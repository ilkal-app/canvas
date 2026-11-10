// The glyph atlas's loan of unused texture memory: a CJK board's visible glyphs can
// need more than the atlases' share (on a tablet, about 36 MiB against 16), while an image board
// fills the textures' share; a board rarely needs both. The scene text atlas borrows what the
// textures neither hold nor want, and gives it back as soon as they want it: textures keep
// priority, so images never draw blank or coarser for the loan.

/** The share of the textures' bytes the loan always leaves them, for images arriving at once. */
export const ATLAS_LOAN_MARGIN_SHARE = 1 / 8;

/** How a loan is set up. */
export interface AtlasLoanOptions {
  /** The textures category's budget, bytes (`bytesByCategory.textures`). */
  readonly texturesBytes: number;
  /** Bytes never lent; default `texturesBytes × ATLAS_LOAN_MARGIN_SHARE`. */
  readonly marginBytes?: number;
}

/**
 * One device budget's loan from the textures to the scene text atlas. The texture manager reports
 * what it holds and wants each update and caps itself at {@link AtlasLoan.textureCapBytes}; the
 * text pass sizes its atlas at its base budget plus {@link AtlasLoan.lendableBytes} each frame and
 * is the borrower whose bytes beyond its base the textures go without. Rendering thread.
 */
export class AtlasLoan {
  private readonly texturesBytes: number;
  private readonly marginBytes: number;
  private textureDemandBytes = 0;
  /** What the textures may hold now (their share scaled down and less GIF reservations). */
  private textureCapacityBytes: number;
  private borrower: (() => number) | undefined;
  private release: ((borrowedBytes: number) => void) | undefined;

  /**
   * A loan with nothing borrowed.
   *
   * @param options - The textures' budget and the margin.
   */
  constructor(options: AtlasLoanOptions) {
    this.texturesBytes = options.texturesBytes;
    this.marginBytes = options.marginBytes ?? options.texturesBytes * ATLAS_LOAN_MARGIN_SHARE;
    this.textureCapacityBytes = options.texturesBytes;
  }

  /**
   * What the textures neither hold nor want of what they may hold now, less the margin: what the
   * atlas may borrow.
   *
   * @returns Bytes, never negative.
   */
  get lendableBytes(): number {
    return Math.max(0, this.textureCapacityBytes - this.textureDemandBytes - this.marginBytes);
  }

  /**
   * What the borrower holds beyond its own budget now.
   *
   * @returns Bytes, never negative; 0 without a borrower.
   */
  get borrowedBytes(): number {
    return Math.max(0, this.borrower?.() ?? 0);
  }

  /**
   * The textures' budget less what is borrowed: the texture manager's cap.
   *
   * @returns Bytes.
   */
  get textureCapBytes(): number {
    return this.texturesBytes - this.borrowedBytes;
  }

  /**
   * Records what the textures hold, what their ideal levels want and what they may hold now, for
   * the next lending.
   *
   * @param residentBytes - The texture manager's resident bytes.
   * @param wantedBytes - The bytes its ideal level picks would take.
   * @param capacityBytes - What the textures may hold now: their share scaled down after an
   *   allocation failure, less GIF reservations; default their whole share.
   */
  reportTextures(
    residentBytes: number,
    wantedBytes: number,
    capacityBytes: number = this.texturesBytes,
  ): void {
    this.textureDemandBytes = Math.max(residentBytes, wantedBytes);
    this.textureCapacityBytes = capacityBytes;
  }

  /**
   * Asks the borrower to give back up to `bytes` now (images that want memory the atlas
   * holds take it within the frame, before they are planned again).
   *
   * @param bytes - The bytes the textures need back.
   */
  reclaim(bytes: number): void {
    const borrowed = this.borrowedBytes;
    if (borrowed > 0 && bytes > 0) this.release?.(Math.max(0, borrowed - bytes));
  }

  /**
   * Names the borrower: how many bytes it holds beyond its own budget, read when asked, and how
   * it gives bytes back.
   *
   * @param borrowed - Its bytes beyond its budget (may be negative while under it).
   * @param release - Brings what it borrows down to at most the given bytes now; none, it gives
   *   back only when it next sizes itself.
   */
  attachBorrower(borrowed: () => number, release?: (borrowedBytes: number) => void): void {
    this.borrower = borrowed;
    this.release = release;
  }
}
