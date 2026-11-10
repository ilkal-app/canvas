import type { AssetId, AssetRecord } from '@canvas/schema';

/**
 * Where a board's images live and who reads them: the assets service,
 * the board the requests act for, and the reader's board token (the relay's token, which the
 * service verifies). Held by the page and by the engine's asset adapter; the token travels only
 * in an `Authorization` header, never in a URL, and nothing here logs a URL or a token.
 */
export interface AssetAccess {
  /** The assets service's base URL (`http://127.0.0.1:1235` in development). */
  readonly assetsUrl: string;
  /** The board the requests act for (`board=`). */
  readonly boardId: string;
  /** The reader's board token for that board. */
  readonly token: string;
}

/** The service's answer to a declaration: an upload to put the bytes to, or none needed. */
export type Declaration =
  | {
      /** The board is already linked to the asset: nothing to upload. */
      readonly status: 'linked';
      /** The asset's record. */
      readonly asset: AssetRecord;
    }
  | {
      /** A new asset, or one declared before: the bytes must be put, as proof of possession. */
      readonly status: 'new' | 'exists';
      /** The upload's id, for the completion. */
      readonly uploadId: string;
      /** The signed URL to put the bytes to. */
      readonly url: string;
      /** The headers the put must carry (its `content-type`). */
      readonly headers: Readonly<Record<string, string>>;
    };

/** What a declaration states about the bytes it will upload. */
export interface DeclaredImage {
  /** The SHA-256 of the bytes, lowercase hex: the asset id. */
  readonly assetId: AssetId;
  /** Their length, bytes. */
  readonly byteLength: number;
  /** Their media type. */
  readonly mimeType: string;
}

/** The `fetch` the client uses; the thread's own by default. */
export type AssetsFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A link card's preview as the assets service answers it. */
export interface LinkPreview {
  /** The page's title, or empty. */
  readonly title: string;
  /** Its description, or empty. */
  readonly description: string;
  /** The site's name, or empty. */
  readonly siteName: string;
  /** The preview image, taken in as an asset of the board; absent when it has none. */
  readonly imageAssetId?: AssetId;
  /** The preview image's size in pixels; absent with it. */
  readonly imageSize?: {
    /** Width in pixels. */
    readonly width: number;
    /** Height in pixels. */
    readonly height: number;
  };
  /** The site's icon, taken in as an asset of the board; absent when it has none. */
  readonly faviconAssetId?: AssetId;
  /** The icon's size in pixels; absent with it. */
  readonly faviconSize?: {
    /** Width in pixels. */
    readonly width: number;
    /** Height in pixels. */
    readonly height: number;
  };
}
