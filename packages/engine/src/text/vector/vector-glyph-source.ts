import { JobCancelledError } from '../../workers/job-errors.js';
import type { JobPriority } from '../../workers/job-priority.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import { glyphFaceOf, type GlyphFace, type GlyphKey } from '../atlas/glyph-key.js';
import type { FontLibrary } from '../font/font-library.js';

import type {
  GlyphGeometryJobRequest,
  GlyphGeometryJobResponse,
} from './glyph-geometry-job-payload.js';
import { GlyphGeometryCache, type GlyphGeometry } from './glyph-geometry.js';
import { glyphGeometryKey } from './vector-run-mesh.js';

/** What a {@link VectorGlyphSource} needs of the worker pool: submitting `glyphGeometry` jobs. */
export interface GlyphGeometryJobSubmitter {
  /**
   * Submits a job (a `WorkerPool`'s `submit`).
   *
   * @param kind - Always `glyphGeometry`.
   * @param request - The batch.
   * @param options - Its priority and the buffers to transfer.
   * @returns The job's ticket.
   */
  submit(
    kind: 'glyphGeometry',
    request: GlyphGeometryJobRequest,
    options: SubmitOptions,
  ): JobTicket<'glyphGeometry'>;
}

/**
 * The vertex bytes the vector tier keeps by default (16 MiB): thousands of glyphs at a few KB
 * each, far more than the screenful that text above 512 px per em can show.
 */
export const DEFAULT_GLYPH_GEOMETRY_BUDGET_BYTES = 16 * 1024 * 1024;

/** The most glyphs one `glyphGeometry` job builds, so one face's burst spreads over workers. */
export const MAX_GLYPH_GEOMETRY_BATCH = 64;

/** How to build a {@link VectorGlyphSource}. */
export interface VectorGlyphSourceOptions {
  /** The worker pool that runs `glyphGeometry` jobs (a `WorkerPool`). */
  readonly pool: GlyphGeometryJobSubmitter;
  /** Where font bytes come from. */
  readonly fonts: FontLibrary;
  /** Where geometry goes; default a cache of {@link DEFAULT_GLYPH_GEOMETRY_BUDGET_BYTES}. */
  readonly cache?: GlyphGeometryCache;
  /** Called after each batch lands in the cache, to schedule a redraw. */
  readonly onGeometryReady?: () => void;
  /** The priority of geometry jobs. Default `visible`: it is asked for text on screen. */
  readonly priority?: JobPriority;
}

/** One face's glyphs asked for in a tick. */
interface PendingFace {
  /** The face and its coordinates. */
  readonly face: GlyphFace;
  /** The keys, in the order first asked for. */
  readonly keys: Set<GlyphKey>;
}

/**
 * Turns the vector tier's geometry requests into `glyphGeometry` jobs and their results into a
 * {@link GlyphGeometryCache}, on the engine's thread, as `GlyphSource` does for atlas glyphs.
 * Requests made in one tick go out together, one job per face (at its coordinates)
 * and {@link MAX_GLYPH_GEOMETRY_BATCH} glyphs; a glyph cached or in flight is not asked for
 * again. A failed job's glyphs are given up on and never asked for again, so a bad font cannot
 * loop; a cancelled job's are forgotten and may be asked for again, as may a glyph the cache has
 * since evicted. A face the font library does not have asks for nothing, until it is loaded.
 */
export class VectorGlyphSource {
  /** Where landed geometry is kept, by `glyphGeometryKey`. */
  readonly cache: GlyphGeometryCache;
  private readonly pending = new Map<string, PendingFace>();
  private readonly inFlight = new Set<string>();
  private readonly failed = new Set<string>();
  private idleWaiters: (() => void)[] = [];
  private isFlushScheduled = false;

  /**
   * Creates the source.
   *
   * @param options - The pool, fonts, cache, redraw callback and priority.
   */
  constructor(private readonly options: VectorGlyphSourceOptions) {
    this.cache = options.cache ?? new GlyphGeometryCache(DEFAULT_GLYPH_GEOMETRY_BUDGET_BYTES);
  }

  /**
   * Whether nothing is pending or in flight.
   *
   * @returns `true` when every requested glyph has landed or been given up on.
   */
  get isIdle(): boolean {
    return this.pending.size === 0 && this.inFlight.size === 0;
  }

  /**
   * A glyph's geometry, if it has landed and is still cached: a `GlyphGeometryLookup`.
   *
   * @param face - The face string (`glyphFaceOf`).
   * @param key - The glyph's key.
   * @returns The geometry, or `undefined`.
   */
  lookup(face: string, key: GlyphKey): GlyphGeometry | undefined {
    return this.cache.get(glyphGeometryKey(face, key));
  }

  /**
   * Asks for a glyph's geometry. Requests made in the same tick go out together, in a microtask.
   *
   * @param face - The face (its `fontFaceId` must be in the font library), at its run's
   *   variable-font coordinates.
   * @param key - The glyph's key: its codepoint, or a shaped glyph's id ({@link GlyphKey}).
   */
  request(face: GlyphFace, key: GlyphKey): void {
    const faceId = glyphFaceOf(face);
    const cacheKey = glyphGeometryKey(faceId, key);
    if (this.inFlight.has(cacheKey) || this.failed.has(cacheKey)) return;
    if (this.cache.get(cacheKey) !== undefined) return;
    let pending = this.pending.get(faceId);
    if (pending === undefined) {
      pending = { face, keys: new Set() };
      this.pending.set(faceId, pending);
    }
    pending.keys.add(key);
    this.scheduleFlush();
  }

  /**
   * Waits until nothing is pending or in flight: for tests and golden scenes, which must draw
   * with final geometry.
   *
   * @returns Resolves when the source is idle.
   */
  whenIdle(): Promise<void> {
    if (this.isIdle) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private scheduleFlush(): void {
    if (this.isFlushScheduled) return;
    this.isFlushScheduled = true;
    void Promise.resolve().then(() => {
      this.flush();
    });
  }

  private flush(): void {
    this.isFlushScheduled = false;
    const faces = [...this.pending.entries()];
    this.pending.clear();
    for (const [faceId, { face, keys }] of faces) {
      const all = [...keys];
      for (let start = 0; start < all.length; start += MAX_GLYPH_GEOMETRY_BATCH) {
        this.submit(face, faceId, all.slice(start, start + MAX_GLYPH_GEOMETRY_BATCH));
      }
    }
    this.notifyIfIdle();
  }

  private submit(face: GlyphFace, faceId: string, glyphs: readonly GlyphKey[]): void {
    const loaded = this.options.fonts.get(face.faceId);
    if (loaded === undefined) return;
    const keys = glyphs.map((glyph) => glyphGeometryKey(faceId, glyph));
    for (const key of keys) this.inFlight.add(key);
    const fontBytes = loaded.bytes;
    const { variations } = face;
    const request: GlyphGeometryJobRequest = {
      faceId,
      fontKey: loaded.fontKey,
      fontBytes,
      keys: glyphs,
      ...(variations === undefined || faceId === face.faceId ? {} : { variations }),
    };
    const priority = this.options.priority ?? 'visible';
    const ticket = this.options.pool.submit('glyphGeometry', request, {
      priority,
      transfer: [fontBytes],
    });
    ticket.response.then(
      (response) => {
        this.land(response);
        this.settle(keys);
      },
      (error: unknown) => {
        if (!(error instanceof JobCancelledError)) for (const key of keys) this.failed.add(key);
        this.settle(keys);
      },
    );
  }

  private land(response: GlyphGeometryJobResponse): void {
    for (const { key, vertices, vertexCount, bounds, edges } of response.glyphs) {
      const geometry = { vertices, vertexCount, bounds, ...(edges === undefined ? {} : { edges }) };
      this.cache.set(glyphGeometryKey(response.faceId, key), geometry);
    }
    this.options.onGeometryReady?.();
  }

  private settle(keys: readonly string[]): void {
    for (const key of keys) this.inFlight.delete(key);
    this.notifyIfIdle();
  }

  private notifyIfIdle(): void {
    if (!this.isIdle) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
