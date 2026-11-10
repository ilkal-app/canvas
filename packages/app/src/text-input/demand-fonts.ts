import {
  fontFaceId,
  type FontFaceKey,
  type FontFaceSource,
  type FontLibrary,
} from '@canvas/engine';
import type { FontWeight } from '@canvas/schema';
import { cjkSliceIdOf } from '@canvas/text';

import type { FontFamilyEntry } from './font-catalogue.js';
import { fetchFontBytes, type FontFetcher } from './load-font-library.js';

/** A family's loading state; failures shouldRetry only after an explicit request. */
export type FontLoadStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'missing';

/** Coalesces family loads and publishes changes without replacing the default face. */
export class DemandFonts {
  private readonly entries = new Map<string, FontFamilyEntry>();
  /** The families installed from this computer (`installLocal`). */
  private readonly local = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();
  private readonly states = new Map<string, FontLoadStatus>();
  private readonly listeners = new Set<() => void>();
  /** Each slice face's load in progress, by face id. */
  private readonly slicePending = new Map<string, Promise<boolean>>();
  /** The slice faces whose load failed, by face id. */
  private readonly sliceFailed = new Set<string>();

  /**
   * Creates a loader without fetching anything.
   *
   * @param fonts - The shared layout/rendering library.
   * @param entries - Available families.
   * @param fetchBytes - Local/self-hosted font transport.
   */
  constructor(
    readonly fonts: FontLibrary,
    entries: readonly FontFamilyEntry[],
    private readonly fetchBytes: FontFetcher = fetchFontBytes,
  ) {
    this.register(entries);
  }

  /**
   * Adds catalogue entries; existing bundled families keep their trusted URLs.
   *
   * @param entries - Families from the self-hosted catalogue.
   */
  register(entries: readonly FontFamilyEntry[]): void {
    for (const entry of entries) {
      if (!this.entries.has(entry.family)) this.entries.set(entry.family, entry);
    }
  }

  /**
   * Reads a family's current state without starting a load.
   *
   * @param family - The stored family name.
   * @returns Its state.
   */
  status(family: string): FontLoadStatus {
    const entry = this.entries.get(family);
    if (entry === undefined) return 'missing';
    if (this.isSliced(family)) return this.requestedSliceStatus(entry);
    // Installed faces are not published until their content identity is ready and listeners
    // can repair sizes written while loading. Keep page layout behind that same boundary.
    if (this.states.get(family) === 'loading') return 'loading';
    if (entry.faces.every((face) => this.fonts.get(fontFaceId(face)) !== undefined)) return 'ready';
    return this.states.get(family) ?? 'idle';
  }

  /**
   * Loads a requested family once; leaves existing faces intact on failure.
   *
   * @param family - The family to preview or use.
   * @param shouldRetry - Explicitly retries a previous failure.
   * @returns Whether every available face is ready.
   */
  ensure(family: string, shouldRetry = false): Promise<boolean> {
    return this.request(family, shouldRetry, Promise.resolve());
  }

  /**
   * Fetches required families concurrently while installing in the saved fallback order.
   *
   * @param families - Known family names in their original order.
   * @returns Whether all requested families loaded.
   */
  async ensureOrdered(families: readonly string[]): Promise<boolean> {
    let previous: Promise<unknown> = Promise.resolve();
    const requests = families.map((family) => {
      const request = this.request(family, false, previous);
      previous = request;
      return request;
    });
    return (await Promise.all(requests)).every(Boolean);
  }

  private request(
    family: string,
    shouldRetry: boolean,
    beforeInstall: Promise<unknown>,
  ): Promise<boolean> {
    // A sliced family is never loaded whole: asked for as a family, its base slice;
    // its characters' slices come through `ensureSlices`.
    if (this.isSliced(family)) return this.ensureSlices(family, ['base'], { shouldRetry });
    const state = this.status(family);
    if (state === 'ready') return Promise.resolve(true);
    const pending = this.pending.get(family);
    if (pending !== undefined) return pending;
    const entry = this.entries.get(family);
    if (entry === undefined || (state === 'failed' && !shouldRetry)) return Promise.resolve(false);
    this.states.set(family, 'loading');
    const loading = this.load(entry, beforeInstall).then((isReady) => {
      this.pending.delete(family);
      this.states.set(family, isReady ? 'ready' : 'failed');
      this.changed();
      return isReady;
    });
    this.pending.set(family, loading);
    this.changed();
    return loading;
  }

  /**
   * Loads some slices of a sliced CJK family, each slice's faces once, without the
   * family's other slices: a text needs only the slices its characters are in.
   *
   * @param family - The family.
   * @param ids - The slice ids (`cjkSliceOf`).
   * @param options - Which weights, and whether to retry a failure.
   * @param options.weights - The weights to load; every weight the family has when absent.
   * @param options.shouldRetry - Explicitly retries a previous failure.
   * @param options.beforeInstall - Settles before the faces are installed, so a caller restoring a
   *   saved order installs them in it; fetching starts at once.
   * @returns Whether every face of those slices is ready.
   */
  async ensureSlices(
    family: string,
    ids: readonly string[],
    options: {
      readonly weights?: readonly FontWeight[] | undefined;
      readonly shouldRetry?: boolean;
      readonly beforeInstall?: Promise<unknown>;
    } = {},
  ): Promise<boolean> {
    const { weights, shouldRetry = false, beforeInstall = Promise.resolve() } = options;
    let started = 0;
    const loads = this.sliceFaces(family, ids, weights).map((face) => {
      const faceId = fontFaceId(face);
      if (this.fonts.get(faceId) !== undefined) return Promise.resolve(true);
      const pending = this.slicePending.get(faceId);
      if (pending !== undefined) return pending;
      if (this.sliceFailed.has(faceId) && !shouldRetry) return Promise.resolve(false);
      this.sliceFailed.delete(faceId);
      const loading = this.loadSlice(face, beforeInstall).then((isReady) => {
        this.slicePending.delete(faceId);
        if (!isReady) this.sliceFailed.add(faceId);
        this.changed();
        return isReady;
      });
      this.slicePending.set(faceId, loading);
      started += 1;
      return loading;
    });
    // Only a load that starts changes the state; slices already ready change nothing.
    if (started > 0) this.changed();
    return (await Promise.all(loads)).every(Boolean);
  }

  /**
   * Some slices' loading state, without starting a load: `ready` once every face of
   * them is installed, `loading` while one loads, `failed` when one failed, `idle` before any
   * asked for them, `missing` for a family the catalogue lacks.
   *
   * @param family - The family.
   * @param ids - The slice ids.
   * @param weights - The weights; every weight the family has when absent.
   * @returns Their state.
   */
  sliceStatus(
    family: string,
    ids: readonly string[],
    weights?: readonly FontWeight[],
  ): FontLoadStatus {
    if (!this.entries.has(family)) return 'missing';
    const faces = this.sliceFaces(family, ids, weights).map((face) => fontFaceId(face));
    if (faces.every((faceId) => this.fonts.get(faceId) !== undefined)) return 'ready';
    if (faces.some((faceId) => this.slicePending.has(faceId))) return 'loading';
    return faces.some((faceId) => this.sliceFailed.has(faceId)) ? 'failed' : 'idle';
  }

  /**
   * A sliced family's state over the slices asked for so far, in the weights asked for: `idle`
   * until one is asked for, then `loading` while any is, `failed` when one failed, else `ready`.
   * Not every weight of its base slice: a text asks for the weights it draws in, and a family
   * whose bold was never asked for would otherwise read as idle for ever (the IME scenario of
   * Waiting on Noto Sans SC).
   *
   * @param entry - The family's catalogue entry.
   * @returns Its state.
   */
  private requestedSliceStatus(entry: FontFamilyEntry): FontLoadStatus {
    const asked = entry.faces
      .map((face) => fontFaceId(face))
      .filter(
        (faceId) =>
          this.fonts.get(faceId) !== undefined ||
          this.slicePending.has(faceId) ||
          this.sliceFailed.has(faceId),
      );
    if (asked.length === 0) return 'idle';
    if (asked.some((faceId) => this.slicePending.has(faceId))) return 'loading';
    return asked.some((faceId) => this.sliceFailed.has(faceId)) ? 'failed' : 'ready';
  }

  /**
   * Whether a family's faces are all CJK slices.
   *
   * @param family - The family.
   * @returns True for a sliced family.
   */
  private isSliced(family: string): boolean {
    const faces = this.entries.get(family)?.faces ?? [];
    return faces.length > 0 && faces.every((face) => cjkSliceIdOf(face) !== undefined);
  }

  /**
   * A sliced family's faces of some slices, in some weights.
   *
   * @param family - The family.
   * @param ids - The slice ids.
   * @param weights - The weights; every weight when absent.
   * @returns The faces, in catalogue order.
   */
  private sliceFaces(
    family: string,
    ids: readonly string[],
    weights: readonly FontWeight[] | undefined,
  ): readonly FontFaceSource[] {
    const wanted = new Set(ids);
    return (this.entries.get(family)?.faces ?? []).filter((face) => {
      const id = cjkSliceIdOf(face);
      return (
        id !== undefined &&
        wanted.has(id) &&
        (weights === undefined || weights.includes(face.weight))
      );
    });
  }

  /**
   * Fetches and installs one slice face.
   *
   * @param face - The slice's face and file.
   * @param beforeInstall - Settles before the face is installed.
   * @returns Whether it installed.
   */
  private async loadSlice(face: FontFaceSource, beforeInstall: Promise<unknown>): Promise<boolean> {
    try {
      const bytes = await this.fetchBytes(face.url);
      await beforeInstall;
      if (this.fonts.get(fontFaceId(face)) === undefined) this.fonts.addFace(face, bytes);
    } catch {
      return false;
    }
    await this.fonts.prepareContentIdentity(this.fonts.faces);
    return true;
  }

  /**
   * Loads saved faces concurrently and installs them in their saved order (a cached font set's,
   * whose content identity depends on it): a plain face's family whole, a CJK slice face as that
   * slice in that weight.
   *
   * @param faces - The faces, in the order they were installed.
   * @returns Whether every one loaded.
   */
  async ensureFacesOrdered(faces: readonly FontFaceKey[]): Promise<boolean> {
    let previous: Promise<unknown> = Promise.resolve();
    const requested = new Set<string>();
    const loads: Promise<boolean>[] = [];
    for (const face of faces) {
      const slice = cjkSliceIdOf(face);
      if (slice === undefined && requested.has(face.family)) continue;
      requested.add(face.family);
      const load =
        slice === undefined
          ? this.request(face.family, false, previous)
          : this.ensureSlices(face.family, [slice], {
              weights: [face.weight],
              beforeInstall: previous,
            });
      previous = load;
      loads.push(load);
    }
    return (await Promise.all(loads)).every(Boolean);
  }

  /**
   * Follows loading and face changes.
   *
   * @param listener - Called after each change.
   * @returns Unsubscribes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * The PostScript names of a family's installed named faces, in registration order:
   * its faces beyond weight and slant that are in the library now.
   *
   * @param family - The family.
   * @returns The names; none for a family without named faces or not installed.
   */
  namedFaces(family: string): readonly string[] {
    const entry = this.entries.get(family);
    if (entry === undefined) return [];
    return entry.faces.flatMap((face) =>
      face.postScriptName !== undefined && this.fonts.get(fontFaceId(face)) !== undefined
        ? [face.postScriptName]
        : [],
    );
  }

  /**
   * Whether a family was installed from this computer, rather than bundled or from
   * the catalogue.
   *
   * @param family - The family.
   * @returns True once `installLocal` installed it.
   */
  isLocal(family: string): boolean {
    return this.local.has(family);
  }

  /**
   * Installs browser-local bytes without a fetch or upload, then publishes to renderers. A file
   * the library cannot read is left out: the family keeps the faces that read.
   *
   * @param family - Local family name.
   * @param files - Validated static faces from Local Font Access.
   * @throws {Error} When no file reads; nothing is registered then.
   */
  installLocal(
    family: string,
    files: readonly {
      readonly face: FontFaceKey;
      readonly bytes: ArrayBuffer;
    }[],
  ): void {
    if (this.entries.has(family)) return;
    const faces = files.flatMap(({ face, bytes }) => {
      try {
        this.fonts.addFace(face, bytes);
      } catch {
        return [];
      }
      return [{ ...face, url: 'local:' }];
    });
    if (faces.length === 0) throw new Error(`Unavailable: no face of ${family} could be read.`);
    this.register([{ family, category: 'sans', faces }]);
    this.local.add(family);
    this.changed();
  }

  private async load(entry: FontFamilyEntry, beforeInstall: Promise<unknown>): Promise<boolean> {
    // Fetch concurrently, install in catalogue order. The default is installed before requests.
    const files = await Promise.allSettled(entry.faces.map((face) => this.fetchBytes(face.url)));
    await beforeInstall;
    let isReady = true;
    files.forEach((result, index) => {
      const face = entry.faces[index];
      if (result.status === 'rejected' || face === undefined) {
        isReady = false;
        return;
      }
      if (this.fonts.get(fontFaceId(face)) !== undefined) return;
      try {
        this.fonts.addFace(face, result.value);
      } catch {
        isReady = false;
      }
    });
    const expected = new Map(
      [...this.fonts.faces, ...entry.faces].map((face) => [fontFaceId(face), face]),
    );
    await this.fonts.prepareContentIdentity([...expected.values()]);
    return isReady;
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
