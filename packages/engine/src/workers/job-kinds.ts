/**
 * The kinds of job the worker pool runs and their typed payloads (the expensive work kept off
 * the frame: text layout, path flattening, mesh building, image decoding). Every
 * payload is structured-cloneable and DOM-free; bulk data travels as typed arrays whose
 * buffers are transferred, not copied.
 *
 * `echo` proves the pipeline end to end. `layout` and `msdf` belong to the text port
 * and `mesh` to path rendering, which define their payloads beside the code that
 * builds and handles them (`text/layout/layout-job-payload.ts`, `text/msdf/msdf-job-payload.ts`,
 * `paths/mesh-job-payload.ts`); `mesh` flattens and meshes in one job, so there is no separate
 * flattening job. The `decode` payload is provisional and belongs to (client texture
 * manager); `frames` decodes an animated GIF's frames for playback. A new kind is one entry in {@link JobPayloads} plus a handler.
 */

import type { MeshJobRequest, MeshJobResponse } from '../paths/mesh-job-payload.js';
import type { LayoutJobRequest, LayoutJobResponse } from '../text/layout/layout-job-payload.js';
import type { MsdfJobRequest, MsdfJobResponse } from '../text/msdf/msdf-job-payload.js';
import type {
  GlyphGeometryJobRequest,
  GlyphGeometryJobResponse,
} from '../text/vector/glyph-geometry-job-payload.js';

/** A request to `echo`: returned unchanged, its buffer transferred there and back. */
export interface EchoJobRequest {
  /** Text copied into the response. */
  readonly message: string;
  /** Bytes transferred to the worker and back again. */
  readonly bytes: ArrayBuffer;
}

/** The response to `echo`: the request's text and bytes. */
export interface EchoJobResponse {
  /** The request's text. */
  readonly message: string;
  /** The request's bytes, transferred back to the caller. */
  readonly bytes: ArrayBuffer;
}

/** A request to decode an image and resize it to pyramid levels, off the main thread. Provisional. */
export interface DecodeJobRequest {
  /** The image asset being decoded. */
  readonly assetId: string;
  /** The encoded image file. */
  readonly bytes: ArrayBuffer;
  /** The file's media type, for example `image/avif`. */
  readonly mimeType: string;
  /** The long edge of each level to produce, in px. */
  readonly longEdgesPx: readonly number[];
}

/** One decoded pyramid level. Provisional. */
export interface DecodedLevel {
  /** The level's width, in px. */
  readonly widthPx: number;
  /** The level's height, in px. */
  readonly heightPx: number;
  /** The level's pixels, RGBA, 8 bits per channel, premultiplied alpha, rows top to bottom. */
  readonly rgba: Uint8Array;
}

/** A decoded image. Provisional. */
export interface DecodeJobResponse {
  /** The image asset that was decoded. */
  readonly assetId: string;
  /** The requested levels, in request order. */
  readonly levels: readonly DecodedLevel[];
}

/**
 * A request to decode an animated image's frames for playback, off the thread that renders:
 * today a GIF.
 */
export interface FramesJobRequest {
  /** The image asset being decoded. */
  readonly assetId: string;
  /** The encoded original. */
  readonly bytes: ArrayBuffer;
  /** The longest edge a frame may have, px. */
  readonly maxLongEdgePx: number;
  /** The most bytes all frames may take together. */
  readonly maxBytes: number;
}

/** One decoded animation frame. */
export interface FramesJobFrame {
  /** RGBA, 8 bits per channel, premultiplied alpha, rows top to bottom. */
  readonly rgba: Uint8Array;
  /** How long it shows, ms. */
  readonly durationMs: number;
}

/** An animated image's frames, all of one size; none for a still image (nothing to play). */
export interface FramesJobResponse {
  /** The image asset that was decoded. */
  readonly assetId: string;
  /** Every frame's width, px. */
  readonly widthPx: number;
  /** Every frame's height, px. */
  readonly heightPx: number;
  /** The frames, in order: two or more, or none for a still image. */
  readonly frames: readonly FramesJobFrame[];
  /** How many times the frames play: a whole number, or `Infinity`. */
  readonly plays: number;
}

/** The request a kind of job takes and the response it gives. */
export interface JobSignature<Request, Response> {
  /** What the job takes. */
  request: Request;
  /** What the job gives back. */
  response: Response;
}

/**
 * The job registry: every kind of job, with the request it takes and the response it gives.
 * The pool, the protocol and the handlers are all typed from this one map.
 */
export interface JobPayloads {
  /** Returns its input; proves the pipeline, transfer included. */
  echo: JobSignature<EchoJobRequest, EchoJobResponse>;
  /** Text layout. */
  layout: JobSignature<LayoutJobRequest, LayoutJobResponse>;
  /** Glyph distance fields: msdfgen, or the raster fallback. */
  msdf: JobSignature<MsdfJobRequest, MsdfJobResponse>;
  /** Vector glyph geometry: HarfBuzz outlines as triangles. */
  glyphGeometry: JobSignature<GlyphGeometryJobRequest, GlyphGeometryJobResponse>;
  /** Path flattening and mesh building. */
  mesh: JobSignature<MeshJobRequest, MeshJobResponse>;
  /** Image decoding and resizing. */
  decode: JobSignature<DecodeJobRequest, DecodeJobResponse>;
  /** Animated image frames for playback. */
  frames: JobSignature<FramesJobRequest, FramesJobResponse>;
}

/** The name of a kind of job, a key of {@link JobPayloads}. */
export type JobKind = keyof JobPayloads;

/** The request a kind of job takes. */
export type JobRequest<K extends JobKind> = JobPayloads[K]['request'];

/** The response a kind of job gives. */
export type JobResponse<K extends JobKind> = JobPayloads[K]['response'];

/**
 * Every kind, as a record so that adding a kind to {@link JobPayloads} without listing it
 * here fails to compile.
 */
const KNOWN_KINDS: Readonly<Record<JobKind, true>> = {
  echo: true,
  layout: true,
  msdf: true,
  glyphGeometry: true,
  mesh: true,
  decode: true,
  frames: true,
};

/**
 * Tells whether a value names a kind of job, for checking messages that crossed a thread.
 *
 * @param value - Any value, typically a message's `kind` field.
 * @returns `true` when `value` is a {@link JobKind}.
 */
export function isJobKind(value: unknown): value is JobKind {
  return typeof value === 'string' && Object.hasOwn(KNOWN_KINDS, value);
}
