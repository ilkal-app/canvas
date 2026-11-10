import type { AssetId } from '@canvas/schema';

import { MAX_IMAGE_PIXELS } from './image-files.js';
import { blobReader, readImageHeaderSize } from './image-header.js';

/** An image's size, px. */
export interface ImagePixelSize {
  /** Width, px. */
  readonly width: number;
  /** Height, px. */
  readonly height: number;
}

/** An image file read for upload: its asset id, upright size, type and length. */
export interface PreparedImage {
  /** The SHA-256 of its bytes, lowercase hex: the asset id. */
  readonly assetId: AssetId;
  /**
   * Its upright size, px (EXIF orientation applied, as the service and browsers show it), from
   * its header: where it is placed. The service reads the image itself; its record keeps the size.
   */
  readonly naturalSize: ImagePixelSize;
  /** Its media type. */
  readonly mimeType: string;
  /** Its length, bytes. */
  readonly byteLength: number;
}

/**
 * What reading a file gave: the prepared image; its size when it has more than 64 megapixels
 * (refused before anything else is read); `unreadable` when its header is not an image the board
 * takes; `reader-failed` when the prepare worker died or could not start; `cancelled` when the
 * preparer was destroyed first.
 */
export type PrepareOutcome =
  | {
      /** The file was read. */
      readonly status: 'prepared';
      /** The image. */
      readonly image: PreparedImage;
    }
  | {
      /** The header says more than 64 megapixels: refused before anything else was read. */
      readonly status: 'too-large';
      /** The size the header says, px. */
      readonly naturalSize: ImagePixelSize;
    }
  | {
      /** `unreadable`, `reader-failed` or `cancelled`. */
      readonly status: 'unreadable' | 'reader-failed' | 'cancelled';
    };

/** Reads an image file's upright size from its header; undefined when it cannot. */
export type SizeReader = (file: Blob) => Promise<ImagePixelSize | undefined>;

/** The most files prepared at once: two, so a drop of many large photos holds two buffers. */
export const MAX_PREPARING = 2;

/**
 * Hex of a digest.
 *
 * @param digest - The digest's bytes.
 * @returns Lowercase hex.
 */
function hexOf(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The SHA-256 of a file, its bytes read in this call only, so they are released once it returns.
 *
 * @param file - The file.
 * @returns The digest.
 */
async function sha256Of(file: Blob): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', await file.arrayBuffer());
}

/**
 * Reads an image file for upload (fix round 1): its upright size from its header without
 * decoding it (`readImageHeaderSize`), refused over {@link MAX_IMAGE_PIXELS} before anything
 * else is read, then its SHA-256 with `crypto.subtle.digest` (the asset id the service verifies
 * after the upload), the file's bytes released once hashed. Nothing is decoded here: the engine
 * decodes the local image in its job workers, and the service reads the image itself. What the
 * prepare worker runs (`prepare-image-worker.ts`), off the page's thread; the page runs it itself
 * only where it cannot start a worker.
 *
 * @param file - The file.
 * @param readSize - Reads its size; its header by default.
 * @returns What it gave; never rejects.
 */
export async function prepareImageFile(file: Blob, readSize?: SizeReader): Promise<PrepareOutcome> {
  const reader: SizeReader = readSize ?? ((blob) => readImageHeaderSize(blobReader(blob)));
  const naturalSize = await reader(file).catch(() => undefined);
  if (naturalSize === undefined) return { status: 'unreadable' };
  if (naturalSize.width * naturalSize.height > MAX_IMAGE_PIXELS) {
    return { status: 'too-large', naturalSize };
  }
  const digest = await sha256Of(file).catch(() => undefined);
  if (digest === undefined) return { status: 'unreadable' };
  const image = {
    assetId: hexOf(digest) as AssetId,
    naturalSize: { width: naturalSize.width, height: naturalSize.height },
    mimeType: file.type,
    byteLength: file.size,
  };
  return { status: 'prepared', image };
}

/** A request to the prepare worker. */
export interface PrepareRequest {
  /** Pairs the answer with the request. */
  readonly id: number;
  /** The file; a `Blob` crosses without copying its bytes. */
  readonly file: Blob;
}

/** The prepare worker's answer. */
export interface PrepareAnswer {
  /** The request's id. */
  readonly id: number;
  /** What reading the file gave. */
  readonly outcome: PrepareOutcome;
}

/** The part of a `Worker` the preparer uses. */
export interface PrepareWorker {
  /** Receives answers. */
  onmessage: ((event: MessageEvent<PrepareAnswer>) => void) | null;
  /** Told when the worker failed to load or threw. */
  onerror: ((event: ErrorEvent) => void) | null;
  /** Told when an answer could not be read. */
  onmessageerror: ((event: MessageEvent) => void) | null;
  /**
   * Sends a request.
   *
   * @param request - The request.
   */
  postMessage(request: PrepareRequest): void;
  /** Stops the worker. */
  terminate(): void;
}

/**
 * Starts the prepare worker (`prepare-image-worker.ts`) as a module worker, where the page can.
 *
 * @returns The worker, or undefined without `Worker`.
 */
function spawnPrepareWorker(): PrepareWorker | undefined {
  if (typeof Worker !== 'function') return undefined;
  // Written inline so Vite recognises the pattern and bundles the worker script.
  return new Worker(new URL('./prepare-image-worker.ts', import.meta.url), {
    type: 'module',
  });
}

/** A file waiting to be prepared, or being prepared. */
interface PrepareJob {
  readonly file: Blob;
  readonly resolve: (outcome: PrepareOutcome) => void;
}

/**
 * Reads image files for upload in a dedicated worker (hashing a large photo takes long enough to
 * drop frames on the page), at most {@link MAX_PREPARING} at once and the rest queued, so a drop
 * of twenty 50 MB photos holds two files' bytes, not a gigabyte. One worker for the page, started
 * on first use; when it fails to load or dies (`error`, `messageerror`), every file waiting
 * settles as `reader-failed` at once (the page says so) and the next file starts a fresh worker.
 * On the page itself where no worker can start.
 */
export class ImagePreparer {
  private readonly spawn: () => PrepareWorker | undefined;
  private readonly readSize: SizeReader | undefined;
  private worker: PrepareWorker | undefined;
  private isSpawned = false;
  private nextId = 1;
  private readonly queue: PrepareJob[] = [];
  private readonly running = new Map<number, PrepareJob>();

  /**
   * Prepares nothing yet.
   *
   * @param spawn - Starts the worker; the bundled module worker by default.
   * @param readSize - How the page reads sizes without a worker; headers by default.
   */
  constructor(spawn: () => PrepareWorker | undefined = spawnPrepareWorker, readSize?: SizeReader) {
    this.spawn = spawn;
    this.readSize = readSize;
  }

  /**
   * Reads a file, after the files queued before it.
   *
   * @param file - The file.
   * @returns What it gave; never rejects.
   */
  prepare(file: Blob): Promise<PrepareOutcome> {
    return new Promise((resolve) => {
      this.queue.push({ file, resolve });
      this.startWaiting();
    });
  }

  /** Stops the worker; files waiting settle as `cancelled`. */
  destroy(): void {
    this.stopWorker();
    this.settleAll({ status: 'cancelled' });
  }

  /** Starts queued files while fewer than {@link MAX_PREPARING} run. */
  private startWaiting(): void {
    while (this.running.size < MAX_PREPARING) {
      const job = this.queue.shift();
      if (job === undefined) return;
      const id = this.nextId;
      this.nextId += 1;
      this.running.set(id, job);
      const worker = this.ensureWorker();
      if (worker === undefined) {
        void prepareImageFile(job.file, this.readSize).then((outcome) => {
          this.settle(id, outcome);
        });
      } else {
        worker.postMessage({ id, file: job.file });
      }
    }
  }

  /**
   * Settles one file and starts the next.
   *
   * @param id - The file's request.
   * @param outcome - What it gave.
   */
  private settle(id: number, outcome: PrepareOutcome): void {
    const job = this.running.get(id);
    if (job === undefined) return;
    this.running.delete(id);
    job.resolve(outcome);
    this.startWaiting();
  }

  /**
   * Settles every file running or queued.
   *
   * @param outcome - What they gave.
   */
  private settleAll(outcome: PrepareOutcome): void {
    const jobs = [...this.running.values(), ...this.queue];
    this.running.clear();
    this.queue.length = 0;
    for (const job of jobs) job.resolve(outcome);
  }

  /** The worker died or never loaded: every waiting file failed, and the next starts a new one. */
  private readonly fail = (): void => {
    this.stopWorker();
    this.settleAll({ status: 'reader-failed' });
  };

  /** Stops the worker, so the next file starts a fresh one. */
  private stopWorker(): void {
    const { worker } = this;
    this.worker = undefined;
    this.isSpawned = false;
    if (worker === undefined) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }

  /**
   * The worker, started on first use and again after it failed.
   *
   * @returns It, or undefined where none can start.
   */
  private ensureWorker(): PrepareWorker | undefined {
    if (this.isSpawned) return this.worker;
    this.isSpawned = true;
    const worker = this.spawn();
    this.worker = worker;
    if (worker === undefined) return undefined;
    worker.onmessage = (event) => {
      const { id, outcome } = event.data;
      this.settle(id, outcome);
    };
    worker.onerror = this.fail;
    worker.onmessageerror = this.fail;
    return worker;
  }
}
