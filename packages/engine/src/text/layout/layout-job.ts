import type { StyleRun } from '@canvas/schema';
import { createMetricsMeasurer, loadShaper, type Shaper } from '@canvas/text';
import { clampLines, fitNoteText, layoutText } from '@canvas/text';
import type { TextLayout } from '@canvas/text';

import type { JobHandler, JobOutcome } from '../../workers/job-handlers.js';
import type { JobId } from '../../workers/job-id.js';
import type { JobPriority } from '../../workers/job-priority.js';
import type { JobResource } from '../../workers/job-submission.js';
import type { WorkerPool } from '../../workers/worker-pool.js';
import type { FontLibrary } from '../font/font-library.js';

import type { LayoutJobRequest } from './layout-job-payload.js';
import { shapingMeasurerOf, type LayoutShaping } from './layout-shaping.js';
import { packTextLayout, unpackTextLayout } from './packed-layout.js';

/**
 * Lays out a `layout` job's request on the calling thread: the synchronous path, for tests and
 * for callers that need a layout this frame.
 *
 * @param request - The text, runs, box settings and font metrics.
 * @param shaping - Shapes the text with HarfBuzz when it has every face's file; without
 *   it, or without a face's file, the text is laid out with per-codepoint metrics.
 * @returns The layout.
 * @throws {RangeError} When the request carries no font metrics or no runs.
 */
export function layoutTextNow(request: LayoutJobRequest, shaping?: LayoutShaping): TextLayout {
  const shaped = shaping === undefined ? undefined : shapingMeasurerOf(request, shaping);
  const measurer = shaped ?? createMetricsMeasurer(request.fonts);
  const { text, runs, maxWidth, align, direction, fitHeight, lineCaps, paragraphs } = request;
  const layoutOf = (source: string, at: readonly StyleRun[]): TextLayout =>
    layoutText(source, at, maxWidth, measurer, align, direction, paragraphs);
  const layoutAt = (at: readonly StyleRun[]): TextLayout => layoutOf(text, at);
  // A link card's title and description, cut to their lines.
  if (lineCaps !== undefined) return clampLines({ text, runs, caps: lineCaps }, layoutOf).layout;
  if (fitHeight === undefined) return layoutAt(runs);
  // A sticky note's text, at the largest size that fits its box.
  return fitNoteText({ text, runs, boxHeight: fitHeight }, layoutAt).layout;
}

/** This thread's shaper while it loads, and once loaded. */
let shaperLoading: Promise<Shaper> | undefined;
let loadedShaper: Shaper | undefined;

/**
 * Whether this thread's shaper has loaded, so a shaped layout job runs synchronously.
 *
 * @returns True once `preloadLayoutShaper` has resolved.
 */
export function isLayoutShaperLoaded(): boolean {
  return loadedShaper !== undefined;
}

/**
 * Starts loading this thread's shaper, if nothing has, so the first shaped layouts need not
 * wait for it: a job worker's handlers and the engine's job pool call it when they are made.
 *
 * @returns Resolves once the shaper has loaded.
 */
export function preloadLayoutShaper(): Promise<Shaper> {
  shaperLoading ??= loadShaper().then((shaper) => {
    loadedShaper = shaper;
    return shaper;
  });
  return shaperLoading;
}

/**
 * Handles `layout` jobs in a job worker or in the pool's main-thread fallback: lays the text
 * out and returns it packed, its two buffers transferred back. When the job's resources hold
 * every face's font file (`requestLayout` with the library), the text is shaped with
 * HarfBuzz, the shaper loaded once per worker; otherwise it is laid out per codepoint. Once the
 * shaper has loaded, a job runs synchronously, so the main-thread fallback's drain counts its
 * work against the frame budget; only a job that arrives while it loads waits for it.
 *
 * @param request - The text, runs, box settings and font metrics.
 * @param context - The job's resources: its faces' files, by font key.
 * @returns The packed layout and its transfer list.
 */
export const layoutJob: JobHandler<'layout'> = (request, context) => {
  const files = request.faces.map(({ fontKey }) => context?.resource(fontKey));
  const isShaped = files.length > 0 && files.every((file) => file !== undefined);
  if (!isShaped) return packed(request, layoutTextNow(request));
  const shapedLayout = (shaper: Shaper): JobOutcome<'layout'> => {
    const shaping: LayoutShaping = {
      shaper,
      bytesOf: (fontKey) => {
        const file = context?.resource(fontKey);
        return file === undefined ? undefined : new Uint8Array(file);
      },
    };
    return packed(request, layoutTextNow(request, shaping));
  };
  if (loadedShaper !== undefined) return shapedLayout(loadedShaper);
  return preloadLayoutShaper().then(shapedLayout);
};

/**
 * A layout job's outcome: the layout packed, its buffers transferred.
 *
 * @param request - The request.
 * @param layout - Its layout.
 * @returns The outcome.
 */
function packed(request: LayoutJobRequest, layout: TextLayout): JobOutcome<'layout'> {
  const packedLayout = packTextLayout(layout);
  return {
    response: { objectId: request.objectId, layout: packedLayout },
    transfer: [packedLayout.glyphs, packedLayout.lines],
  };
}

/**
 * The font files of a layout's faces, as job resources.
 *
 * @param request - The layout request.
 * @param library - The loaded faces.
 * @returns One resource per face the library still holds under the request's font key.
 */
function resourcesOf(request: LayoutJobRequest, library: FontLibrary): JobResource[] {
  return request.faces.flatMap(({ faceId, fontKey }) => {
    const resource = library.jobResource(faceId);
    return resource?.key === fontKey ? [resource] : [];
  });
}

/** A submitted layout: its job id (to cancel or re-prioritise it) and the eventual layout. */
export interface LayoutTicket {
  /** The job's id in the pool. */
  readonly id: JobId;
  /** Resolves with the unpacked layout; rejects as the pool's job does. */
  readonly layout: Promise<TextLayout>;
}

/**
 * Submits a layout to the worker pool, which runs it on a worker or, without workers, on the
 * main thread a frame budget at a time; the old layout keeps drawing meanwhile.
 *
 * @param pool - The engine's worker pool.
 * @param request - The request, from `createLayoutJobRequest`.
 * @param priority - How urgently the layout is needed (`visible` for on-screen text).
 * @param library - The loaded faces. When given, each face's font file goes with the job as a
 *   resource, which the pool sends to each worker once (shaping reads it).
 * @returns The ticket.
 */
export function requestLayout(
  pool: Pick<WorkerPool, 'submit'>,
  request: LayoutJobRequest,
  priority: JobPriority,
  library?: FontLibrary,
): LayoutTicket {
  const resources = library === undefined ? [] : resourcesOf(request, library);
  const ticket = pool.submit('layout', request, { priority, resources });
  return { id: ticket.id, layout: ticket.response.then(({ layout }) => unpackTextLayout(layout)) };
}
