import { JobCancelledError } from '../../workers/job-errors.js';
import type { JobPriority } from '../../workers/job-priority.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import type { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphField } from '../atlas/glyph-bitmap.js';
import { glyphFaceOf, type GlyphFace, type GlyphKey } from '../atlas/glyph-key.js';
import type { GlyphTier } from '../atlas/glyph-tiers.js';
import type { FontLibrary } from '../font/font-library.js';

import { planGlyphBatches } from './glyph-batches.js';
import type { MsdfJobRequest, MsdfJobResponse } from './msdf-job-payload.js';

/** What a {@link GlyphSource} needs of the worker pool: submitting `msdf` jobs. */
export interface MsdfJobSubmitter {
  /**
   * Submits a job, as `WorkerPool.submit` does: the handler must read `options.resources` through
   * its context, since a batch names its font by key and carries no bytes.
   *
   * @param kind - Always `msdf`.
   * @param request - The batch to generate.
   * @param options - Priority and the face's font as the job's resource.
   * @returns The job's ticket.
   */
  submit(kind: 'msdf', request: MsdfJobRequest, options: SubmitOptions): JobTicket<'msdf'>;
}

/** How to set up a {@link GlyphSource}. */
export interface GlyphSourceOptions {
  /** The worker pool that runs `msdf` jobs (a `WorkerPool`). */
  readonly pool: MsdfJobSubmitter;
  /** Where font bytes come from. */
  readonly fonts: FontLibrary;
  /** Where generated glyphs go. */
  readonly atlas: GlyphAtlas;
  /** Called after each batch lands in the atlas, to schedule a redraw. */
  readonly onGlyphsReady?: () => void;
  /** The priority of glyph jobs. Default `visible`: glyphs are requested for text on screen. */
  readonly priority?: JobPriority;
}

/** Glyphs of one face and tier waiting to be sent. */
interface PendingBatch {
  /** The face and its coordinates. */
  readonly face: GlyphFace;
  /** Its `glyphFaceOf` string: the atlas's and the bookkeeping's face. */
  readonly faceId: string;
  readonly tier: GlyphTier;
  readonly keys: Set<GlyphKey>;
}

/** The most ticks a rejected glyph is ignored for: about a second of frames at 60 fps. */
const MAX_REJECTION_BACKOFF = 64;

function keyOf(faceId: string, glyph: GlyphKey, tier: GlyphTier): string {
  return `${String(tier)}|${String(glyph)}|${faceId}`;
}

/**
 * Turns glyph requests into `msdf` jobs and their results into atlas entries, on the engine's
 * thread (the prototype's `MsdfSource`, `src/atlas/msdfSource.ts`, onto the worker pool).
 * Requests made in one tick are coalesced per face and tier and split into batches; a glyph
 * pending or in flight is not requested again. A batch that fails (a crashed worker, an
 * unreadable font) is retried once with the raster fallback; if that fails too, its glyphs are
 * given up on and never requested again, so a bad font cannot loop. A cancelled batch is
 * forgotten and may be requested again. A glyph the atlas rejects for lack of budget is not
 * requested again for the next 2, 4, 8, … up to 64 ticks in which it is asked for (once per frame
 * when a frame builds its quads), however many times each tick asks, so a full atlas does not
 * regenerate it every frame.
 */
export class GlyphSource {
  private readonly pending = new Map<string, PendingBatch>();
  private readonly inFlight = new Set<string>();
  private readonly failed = new Set<string>();
  /**
   * Glyphs the atlas turned away for lack of budget: in how many more ticks their requests are
   * ignored, doubling with each rejection, so a full atlas does not regenerate them every frame.
   */
  private readonly rejected = new Map<string, { skipsLeft: number; backoff: number }>();
  /** Rejected glyphs asked for in this tick; each one's backoff is counted down once at flush. */
  private readonly suppressedThisTick = new Set<string>();
  private idleWaiters: (() => void)[] = [];
  private isFlushScheduled = false;

  /**
   * Creates the source.
   *
   * @param options - The pool, fonts, atlas, redraw callback and priority.
   */
  constructor(private readonly options: GlyphSourceOptions) {}

  /**
   * Whether nothing is pending or in flight.
   *
   * @returns `true` when every requested glyph has landed or been given up on.
   */
  get isIdle(): boolean {
    return this.pending.size === 0 && this.inFlight.size === 0;
  }

  /**
   * Asks for a glyph. Requests made in the same tick go out together, in a microtask.
   *
   * @param face - The face (its `fontFaceId` must be in the font library), at its run's
   *   variable-font coordinates; each instance's glyphs are their own.
   * @param glyph - The glyph's key: its codepoint, or a shaped glyph's id ({@link GlyphKey}).
   * @param tier - Texels per em.
   */
  request(face: GlyphFace, glyph: GlyphKey, tier: GlyphTier): void {
    const faceId = glyphFaceOf(face);
    const key = keyOf(faceId, glyph, tier);
    if (this.inFlight.has(key) || this.failed.has(key)) return;
    if ((this.rejected.get(key)?.skipsLeft ?? 0) > 0) {
      // Counted down once per tick at flush, not once per call: a frame asks once per occurrence.
      this.suppressedThisTick.add(key);
      this.scheduleFlush();
      return;
    }
    const batchKey = `${String(tier)}|${faceId}`;
    let batch = this.pending.get(batchKey);
    if (batch === undefined) {
      batch = { face, faceId, tier, keys: new Set() };
      this.pending.set(batchKey, batch);
    }
    batch.keys.add(glyph);
    this.scheduleFlush();
  }

  /**
   * Waits until nothing is pending or in flight: for tests and for golden scenes, which must
   * draw with final glyphs.
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
    for (const key of this.suppressedThisTick) {
      const rejection = this.rejected.get(key);
      if (rejection !== undefined) rejection.skipsLeft -= 1;
    }
    this.suppressedThisTick.clear();
    const batches = [...this.pending.values()];
    this.pending.clear();
    for (const { face, faceId, tier, keys } of batches) {
      for (const batch of planGlyphBatches([...keys], tier, this.options.atlas.pageSize))
        this.submit(face, faceId, tier, batch, 'msdf');
    }
    this.notifyIfIdle();
  }

  private submit(
    face: GlyphFace,
    faceId: string,
    tier: GlyphTier,
    glyphs: readonly GlyphKey[],
    field: GlyphField,
  ): void {
    const loaded = this.options.fonts.get(face.faceId);
    if (loaded === undefined) return;
    const keys = glyphs.map((glyph) => keyOf(faceId, glyph, tier));
    for (const key of keys) this.inFlight.add(key);
    const { variations } = face;
    // The font file goes as the job's resource, which the pool sends to each worker once:
    // a copy per batch held hundreds of MB of CJK fonts in queued jobs.
    const resource = loaded.jobResource;
    const request: MsdfJobRequest = {
      faceId,
      fontKey: resource.key,
      keys: glyphs,
      tier,
      field,
      ...(variations === undefined || faceId === face.faceId ? {} : { variations }),
    };
    const priority = this.options.priority ?? 'visible';
    const ticket = this.options.pool.submit('msdf', request, { priority, resources: [resource] });
    ticket.response.then(
      (response) => {
        this.land(response);
        this.settle(keys);
      },
      (error: unknown) => {
        this.settle(keys);
        if (error instanceof JobCancelledError) return;
        if (field === 'msdf') this.submit(face, faceId, tier, glyphs, 'sdf');
        else for (const key of keys) this.failed.add(key);
        this.notifyIfIdle();
      },
    );
  }

  private land(response: MsdfJobResponse): void {
    for (const { key: glyph, bitmap } of response.glyphs) {
      const key = keyOf(response.faceId, glyph, response.tier);
      const placed = this.options.atlas.insert(response.faceId, glyph, response.tier, bitmap);
      if (placed !== undefined) {
        this.rejected.delete(key);
      } else {
        const backoff = Math.min(MAX_REJECTION_BACKOFF, (this.rejected.get(key)?.backoff ?? 1) * 2);
        this.rejected.set(key, { skipsLeft: backoff, backoff });
      }
    }
    this.options.onGlyphsReady?.();
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
