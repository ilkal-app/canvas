import type { FontFormatError } from '@canvas/text';
import { fontFaceId, resolveFontFace, type FontFaceKey } from '@canvas/text';
import { createFontMetrics, type FontMetrics } from '@canvas/text';
import { parseFont, type ParsedFont } from '@canvas/text';

import type { JobResource } from '../../workers/job-submission.js';

import { fontContentIdentity } from './font-content-identity.js';

/**
 * A library-owned immutable face descriptor. Parsed font/metrics are read-only library state;
 * `bytes` returns a fresh transferable copy, never the buffer backing the parsed font.
 */
export interface LoadedFontFace {
  /** The face's family, weight and slant. */
  readonly face: FontFaceKey;
  /** Its {@link fontFaceId}. */
  readonly faceId: string;
  /**
   * Identifies these bytes on this thread: the face id plus a count of faces added by every
   * library, so a face replaced under the same id, or loaded with other bytes by another
   * library sharing the job pool, gets a new key, and workers, which cache fonts and job
   * resources by key, never serve one face's bytes for another.
   */
  readonly fontKey: string;
  /** The parsed font: character map, metrics, kerning and outlines. */
  readonly font: ParsedFont;
  /** The full metrics table, from which `layout` jobs take subsets. */
  readonly metrics: FontMetrics;
  /** A fresh copy of the parsed font file on every access; safe to mutate or transfer. */
  readonly bytes: ArrayBuffer;
  /**
   * The font file as a job resource under `fontKey`, the same object on every access: a copy
   * made once, apart from the buffer the parsed font reads, which the pool copies to each
   * worker once. Never change or transfer its bytes.
   */
  readonly jobResource: JobResource;
}

/** Faces added by every library on this thread (a pool and its libraries share one): keys stay unique. */
let loadedFontCount = 0;

/**
 * The font faces loaded on the engine's thread, keyed by {@link fontFaceId}. Text styles name a
 * family, weight and slant; {@link FontLibrary.resolve} picks the loaded face that draws them,
 * falling back to the first face added, so every run renders in some face. Tests load the
 * bundled Liberation Sans faces (`packages/engine/assets/fonts`) for determinism.
 */
export class FontLibrary {
  private readonly loaded = new Map<string, LoadedFontFace>();
  private addedCount = 0;
  private identityRequest = 0;
  private identity: string | undefined;

  /**
   * Monotonic local generation for cache invalidation, including same-face replacements.
   *
   * @returns Number of successfully added font files; not a persistent content identity.
   */
  get revision(): number {
    return this.addedCount;
  }

  /**
   * Successfully hashed complete catalogue, absent until explicitly prepared.
   *
   * @returns Immutable content identity; additions and replacements invalidate it immediately.
   */
  get contentIdentity(): string | undefined {
    return this.identity;
  }

  /**
   * Prepares identity only when every configured face parsed successfully in the expected order.
   * Custom libraries opt in explicitly; a resolved loading promise alone is not evidence.
   *
   * @param expected - Complete configured catalogue, default face first.
   * @returns The current content identity, or undefined after failure or a concurrent change.
   */
  async prepareContentIdentity(expected: readonly FontFaceKey[]): Promise<string | undefined> {
    this.identity = undefined;
    const request = ++this.identityRequest;
    const revision = this.addedCount;
    const identity = await fontContentIdentity([...this.loaded.values()], expected);
    if (revision !== this.addedCount || request !== this.identityRequest) return undefined;
    this.identity = identity;
    return identity;
  }

  /**
   * The loaded faces, in the order they were first added; the first is the default.
   *
   * @returns The face keys.
   */
  get faces(): readonly FontFaceKey[] {
    return [...this.loaded.values()].map(({ face }) => face);
  }

  /**
   * Parses and adds a face, replacing a face with the same id. The library keeps its own copy of
   * the bytes, so the caller may reuse or transfer them.
   *
   * @param face - The family, weight and slant the bytes are loaded as.
   * @param bytes - The font file.
   * @returns The loaded face.
   * @throws {FontFormatError} When the bytes are not a readable font; the library is unchanged.
   */
  addFace(face: FontFaceKey, bytes: ArrayBuffer): LoadedFontFace {
    const copy = bytes.slice(0);
    const font = parseFont(copy);
    const faceId = fontFaceId(face);
    this.addedCount += 1;
    this.identity = undefined;
    const ownedFace = Object.freeze({ ...face });
    loadedFontCount += 1;
    const fontKey = `${faceId}#${String(loadedFontCount)}`;
    let jobResource: JobResource | undefined;
    const loaded: LoadedFontFace = Object.freeze({
      face: ownedFace,
      faceId,
      fontKey,
      font,
      metrics: createFontMetrics(ownedFace, font),
      get bytes(): ArrayBuffer {
        return copy.slice(0);
      },
      get jobResource(): JobResource {
        jobResource ??= Object.freeze({ key: fontKey, bytes: copy.slice(0) });
        return jobResource;
      },
    });
    this.loaded.set(faceId, loaded);
    return loaded;
  }

  /**
   * A loaded face's font file as a job resource.
   *
   * @param faceId - A {@link fontFaceId}.
   * @returns Its {@link LoadedFontFace.jobResource}, or `undefined` when it is not loaded.
   */
  jobResource(faceId: string): JobResource | undefined {
    return this.loaded.get(faceId)?.jobResource;
  }

  /**
   * A loaded face by id.
   *
   * @param faceId - A {@link fontFaceId}.
   * @returns The face, or `undefined` when it is not loaded.
   */
  get(faceId: string): LoadedFontFace | undefined {
    return this.loaded.get(faceId);
  }

  /**
   * The loaded face that draws a requested face, with `resolveFontFace`'s fallbacks.
   *
   * @param wanted - The face a text run asks for.
   * @returns The face to draw with, or `undefined` when no face is loaded.
   */
  resolve(wanted: FontFaceKey): LoadedFontFace | undefined {
    const face = resolveFontFace(this.faces, wanted);
    return face === undefined ? undefined : this.loaded.get(fontFaceId(face));
  }
}
