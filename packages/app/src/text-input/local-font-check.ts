// Untrusted font files are read off the page first: a local font's bytes come from
// whatever file is installed on the computer, so before the page parses them they are read, as the
// page will read them, in a dedicated worker. A file that throws, crashes the worker or takes past
// the time limit fails that face only, and the page never parses it.
import { loadShaper, parseFont, shapeText } from '@canvas/text';

/** Whether a font file can be read, and why not. */
export type FontCheck =
  { readonly isReadable: true } | { readonly isReadable: false; readonly reason: string };

/** How long a check may take before its worker is stopped and the face refused (10 s). */
export const LOCAL_FONT_CHECK_TIMEOUT_MS = 10_000;

/** How many of a font's characters the check shapes. */
const SAMPLE_CHARACTERS = 64;

/** Gives each checked file a face id of its own in the shaper. */
let nextFaceId = 1;

/**
 * A check's failure as its result.
 *
 * @param error - What was thrown.
 * @returns The unreadable result, naming it.
 */
function unreadable(error: unknown): FontCheck {
  return { isReadable: false, reason: error instanceof Error ? error.message : String(error) };
}

/**
 * Reads a font file as the page will: parses it, reads its character map, and shapes
 * up to 64 of the characters it maps with HarfBuzz. Run in the check worker; on the page only
 * where no worker can start.
 *
 * @param bytes - The font file, left as it is.
 * @returns Whether it read; never rejects.
 */
export async function checkFontBytes(bytes: ArrayBuffer): Promise<FontCheck> {
  try {
    const font = parseFont(bytes);
    const sample = font
      .characterMap()
      .slice(0, SAMPLE_CHARACTERS)
      .map(([codepoint]) => String.fromCodePoint(codepoint))
      .join('');
    const shaper = await loadShaper();
    const face = shaper.face(`local-font-check#${String(nextFaceId)}`, new Uint8Array(bytes));
    nextFaceId += 1;
    shapeText(shaper, face, sample, 0, sample.length);
    return { isReadable: true };
  } catch (error) {
    return unreadable(error);
  }
}

/** A request to the check worker. */
export interface FontCheckRequest {
  /** Pairs the answer with the request. */
  readonly id: number;
  /** A copy of the font file, transferred. */
  readonly bytes: ArrayBuffer;
}

/** The check worker's answer. */
export interface FontCheckAnswer {
  /** The request's id. */
  readonly id: number;
  /** Whether the file read. */
  readonly isReadable: boolean;
  /** Why not, when it did not. */
  readonly reason?: string;
}

/** The part of a `Worker` the checker uses. */
export interface FontCheckWorker {
  /** Receives answers. */
  onmessage: ((event: MessageEvent<FontCheckAnswer>) => void) | null;
  /** Told when the worker failed to load or threw. */
  onerror: ((event: ErrorEvent) => void) | null;
  /** Told when an answer could not be read. */
  onmessageerror: ((event: MessageEvent) => void) | null;
  /**
   * Sends a request.
   *
   * @param request - The request.
   * @param transfer - The buffers it hands over.
   */
  postMessage(request: FontCheckRequest, transfer: Transferable[]): void;
  /** Stops the worker. */
  terminate(): void;
}

/**
 * Starts the check worker (`local-font-check-worker.ts`) as a module worker, where the page can.
 *
 * @returns The worker, or undefined without `Worker`.
 */
function spawnFontCheckWorker(): FontCheckWorker | undefined {
  if (typeof Worker !== 'function') return undefined;
  // Written inline so Vite recognises the pattern and bundles the worker script.
  return new Worker(new URL('./local-font-check-worker.ts', import.meta.url), { type: 'module' });
}

/** A file waiting to be checked. */
interface CheckJob {
  readonly bytes: ArrayBuffer;
  readonly resolve: (check: FontCheck) => void;
}

/** The check in flight. */
interface RunningCheck {
  readonly id: number;
  readonly job: CheckJob;
  readonly timer: ReturnType<typeof setTimeout> | undefined;
}

/** How a checker is set up; each has a default. */
export interface LocalFontCheckerOptions {
  /** Starts the worker; the bundled module worker by default. */
  readonly spawn?: () => FontCheckWorker | undefined;
  /** How long a check may take; {@link LOCAL_FONT_CHECK_TIMEOUT_MS} by default. */
  readonly timeoutMs?: number;
  /** How the page checks a file where no worker can start; {@link checkFontBytes} by default. */
  readonly checkOnPage?: (bytes: ArrayBuffer) => Promise<FontCheck>;
}

/**
 * Checks local font files in a dedicated worker, one at a time and the rest queued.
 * One worker, started on first use; when it fails, dies or takes past the time limit, it is
 * stopped, the check in flight refuses its file, and the next check starts a fresh worker. Each
 * file is sent as a copy, so the caller's bytes stay usable. On the page where no worker can start.
 */
export class LocalFontChecker {
  private readonly spawn: () => FontCheckWorker | undefined;
  private readonly timeoutMs: number;
  private readonly checkOnPage: (bytes: ArrayBuffer) => Promise<FontCheck>;
  private worker: FontCheckWorker | undefined;
  private readonly queue: CheckJob[] = [];
  private running: RunningCheck | undefined;
  private nextId = 1;

  /**
   * Checks nothing yet.
   *
   * @param options - The worker, time limit and page check; each has a default.
   * @param options.spawn - Starts the worker.
   * @param options.timeoutMs - How long a check may take.
   * @param options.checkOnPage - How the page checks a file without a worker.
   */
  constructor({
    spawn = spawnFontCheckWorker,
    timeoutMs = LOCAL_FONT_CHECK_TIMEOUT_MS,
    checkOnPage = checkFontBytes,
  }: LocalFontCheckerOptions = {}) {
    this.spawn = spawn;
    this.timeoutMs = timeoutMs;
    this.checkOnPage = checkOnPage;
  }

  /**
   * Checks a font file, after the files queued before it.
   *
   * @param bytes - The file; it is copied, never detached.
   * @returns Whether it read; never rejects.
   */
  check(bytes: ArrayBuffer): Promise<FontCheck> {
    return new Promise((resolve) => {
      this.queue.push({ bytes, resolve });
      this.startNext();
    });
  }

  /** Starts the next queued check when none is in flight. */
  private startNext(): void {
    if (this.running !== undefined) return;
    const job = this.queue.shift();
    if (job === undefined) return;
    const id = this.nextId;
    this.nextId += 1;
    const worker = this.startedWorker();
    if (worker === undefined) {
      this.running = { id, job, timer: undefined };
      void this.checkOnPage(job.bytes).then(
        (check) => {
          this.settle(id, check);
        },
        (error: unknown) => {
          this.settle(id, unreadable(error));
        },
      );
      return;
    }
    const timer = setTimeout(() => {
      this.stopWorker();
      this.settle(id, {
        isReadable: false,
        reason: `The font check timed out after ${String(this.timeoutMs)} ms.`,
      });
    }, this.timeoutMs);
    this.running = { id, job, timer };
    const copy = job.bytes.slice(0);
    try {
      worker.postMessage({ id, bytes: copy }, [copy]);
    } catch (error) {
      // The worker could not take the file: refuse it, and start afresh for the next.
      this.stopWorker();
      this.settle(id, unreadable(error));
    }
  }

  /**
   * The worker, or none where it cannot start: a spawn that throws (a page whose policy forbids
   * workers, say) checks on the page, as one without `Worker` does.
   *
   * @returns The worker, or undefined.
   */
  private startedWorker(): FontCheckWorker | undefined {
    try {
      return this.ensureWorker();
    } catch {
      return undefined;
    }
  }

  /**
   * Settles the check in flight, if it is this one, and starts the next.
   *
   * @param id - The check's request.
   * @param check - Its result.
   */
  private settle(id: number, check: FontCheck): void {
    const running = this.running;
    if (running?.id !== id) return;
    if (running.timer !== undefined) clearTimeout(running.timer);
    this.running = undefined;
    running.job.resolve(check);
    this.startNext();
  }

  /**
   * The worker, started when there is none.
   *
   * @returns It, or undefined where none can start.
   */
  private ensureWorker(): FontCheckWorker | undefined {
    if (this.worker !== undefined) return this.worker;
    const worker = this.spawn();
    if (worker === undefined) return undefined;
    worker.onmessage = (event) => {
      const { id, isReadable, reason } = event.data;
      this.settle(
        id,
        isReadable
          ? { isReadable: true }
          : { isReadable: false, reason: reason ?? 'The font cannot be read.' },
      );
    };
    worker.onerror = this.fail;
    worker.onmessageerror = this.fail;
    this.worker = worker;
    return worker;
  }

  /** The worker died or never loaded: the check in flight refuses its file. */
  private readonly fail = (): void => {
    const id = this.running?.id;
    this.stopWorker();
    if (id !== undefined) {
      this.settle(id, { isReadable: false, reason: 'The font check worker stopped.' });
    }
  };

  /** Stops the worker; the next check starts a fresh one. */
  private stopWorker(): void {
    const worker = this.worker;
    if (worker === undefined) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    this.worker = undefined;
  }
}
