import type { ObjectId } from '@canvas/schema';
import { SPACE, type TextLayout } from '@canvas/text';

import type { LevelOfDetail } from '../../lod/level-of-detail.js';
import type { ScenePassEnvironment } from '../../scene/scene-pass.js';
import { glyphFaceOf, glyphKeyOf, type GlyphFace, type GlyphKey } from '../atlas/glyph-key.js';
import type { TextTierOptions } from '../atlas/glyph-tiers.js';
import type { GlyphGeometry } from '../vector/glyph-geometry.js';
import { VectorGlyphSource } from '../vector/vector-glyph-source.js';

import type { OrderedGlyphQuads, VectorGlyphPolicy } from './ordered-glyph-quads.js';
import type { TextObjectEntry } from './text-object-entry.js';
import type { TextPassResources } from './text-pass-resources.js';
import { TEXT_VECTOR_PASS_NAME } from './text-vector-names.js';

/** A text drawing runs from their outlines: its entry, the layout and the runs. */
export interface DrawnText {
  /** The text pass's entry: its box (`geometry`) places the runs. */
  readonly entry: TextObjectEntry;
  /** The layout the runs are laid out in. */
  readonly layout: TextLayout;
  /** The runs drawn from their outlines, ascending. */
  readonly runs: readonly number[];
}

/**
 * The text pass's side of the vector glyph tier: the glyphs' geometry, asked of a
 * {@link VectorGlyphSource} as runs reach the vector tier, which texts wait for some, and which
 * draw runs from their outlines (what the `textVector` companion pass draws). A face added or
 * replaced (`FontLibrary.revision`) drops every glyph's geometry, so none of a replaced face is
 * drawn again. The thread that renders.
 */
export class TextVectorState implements VectorGlyphPolicy, TextTierOptions {
  /** Picks the vector tier: the state is the pass's tier options as well. */
  readonly isVectorEnabled = true;
  /** Texts drawing runs from their outlines, with what they draw: the companion's to draw. */
  readonly drawn = new Map<ObjectId, DrawnText>();
  private source: VectorGlyphSource;
  private fontsRevision: number;
  private landings = 0;
  private drops = 0;
  private drawnVersion = 0;
  /** Texts with a run at the vector tier still waiting for geometry. */
  private readonly waiting = new Set<ObjectId>();

  /**
   * Starts with no geometry.
   *
   * @param resources - The fonts, and the pool `glyphGeometry` jobs go to.
   * @param landed - Where texts go whose waited-for geometry landed, to be rewritten.
   * @param requestFrame - Asks for a frame to rewrite them in.
   */
  constructor(
    private readonly resources: TextPassResources,
    private readonly landed: Set<ObjectId>,
    private readonly requestFrame: () => void,
  ) {
    this.fontsRevision = resources.fonts.revision;
    this.source = this.createSource();
  }

  /**
   * Changes whenever a run's readiness can change: geometry landed, or all of it dropped.
   *
   * @returns The revision.
   */
  get revision(): number {
    return this.landings;
  }

  /**
   * Whether nothing is in flight: every glyph's geometry asked for has landed or been given up
   * on, and no text waits for any.
   *
   * @returns True when idle.
   */
  get isIdle(): boolean {
    return this.source.isIdle && this.waiting.size === 0;
  }

  /**
   * Changes whenever all geometry is dropped (a face added or replaced): what was built from the
   * old geometry, such as the companion's meshes, is stale then.
   *
   * @returns The generation.
   */
  get generation(): number {
    return this.drops;
  }

  /**
   * Changes whenever the set of texts drawing runs from their outlines, or what they draw,
   * changes: the companion's drawer rebuilds its draws then.
   *
   * @returns The version.
   */
  get version(): number {
    return this.drawnVersion;
  }

  /**
   * Starts a frame: a face added or replaced since the last drops all geometry.
   *
   * @returns Whether it was dropped, so every text must be built again.
   */
  beginFrame(): boolean {
    const { revision } = this.resources.fonts;
    if (revision === this.fontsRevision) return false;
    this.fontsRevision = revision;
    this.source = this.createSource();
    this.landings += 1;
    this.drops += 1;
    return true;
  }

  /**
   * A glyph's geometry, if it is cached: a `GlyphGeometryLookup`.
   *
   * @param face - The face string (`glyphFaceOf`).
   * @param key - The glyph's key.
   * @returns The geometry, or `undefined`.
   */
  lookup(face: string, key: GlyphKey): GlyphGeometry | undefined {
    return this.source.lookup(face, key);
  }

  /**
   * Whether every glyph of a run that is not a space has its geometry, asking for what is
   * missing.
   *
   * @param layout - The laid-out text.
   * @param run - The run: an index into `layout.runs`.
   * @param face - The run's face, at its coordinates.
   * @returns Whether the run's geometry is all there.
   */
  isRunReady(layout: TextLayout, run: number, face: GlyphFace): boolean {
    const faceId = glyphFaceOf(face);
    let isReady = true;
    for (const glyph of layout.glyphs) {
      if (glyph.run !== run || glyph.codepoint === SPACE) continue;
      const key = glyphKeyOf(glyph);
      if (this.source.lookup(faceId, key) !== undefined) continue;
      this.source.request(face, key);
      isReady = false;
    }
    return isReady;
  }

  /**
   * Notes a text's entry once its quads are built: whether it waits for geometry, and whether
   * it draws runs from their outlines.
   *
   * @param id - The text.
   * @param entry - Its entry.
   * @param layout - The layout its quads were built from.
   * @param quads - The quads just built.
   */
  note(id: ObjectId, entry: TextObjectEntry, layout: TextLayout, quads: OrderedGlyphQuads): void {
    const { tiers, vectorRuns: runs } = quads;
    const isWaiting = tiers.some((tier, run) => tier === 'vector' && !runs.includes(run));
    if (isWaiting) this.waiting.add(id);
    else this.waiting.delete(id);
    if (runs.length > 0) {
      this.drawn.set(id, { entry, layout, runs });
      this.drawnVersion += 1;
    } else if (this.drawn.delete(id)) {
      this.drawnVersion += 1;
    }
  }

  /**
   * Has a text built again: its drawn runs' geometry was evicted, so until it lands again they
   * draw from the atlas.
   *
   * @param id - The text.
   */
  invalidate(id: ObjectId): void {
    this.landed.add(id);
    this.requestFrame();
  }

  /**
   * The vector policy a text's quads are built with: this state, unless the companion hides the
   * text, whose runs then draw from the atlas. The companion's level of detail can lag a zoom
   * (its changes are budgeted per frame), and a run left to it while hidden would not draw.
   *
   * @param id - The text.
   * @param lod - The scene's level of detail, if any.
   * @returns This state, or `undefined`.
   */
  policyFor(id: ObjectId, lod: LevelOfDetail | undefined): this | undefined {
    return lod?.formOf(TEXT_VECTOR_PASS_NAME, id) === 'hidden' ? undefined : this;
  }

  /**
   * Adds the texts the companion now shows or hides to those to rewrite: their runs switch
   * between the atlas and their outlines.
   *
   * @param lod - The scene's level of detail.
   * @param stale - The texts to rewrite.
   */
  noteDetailChanges(lod: LevelOfDetail, stale: Set<ObjectId>): void {
    for (const id of lod.changedIn(TEXT_VECTOR_PASS_NAME)) stale.add(id);
  }

  /**
   * Forgets a text.
   *
   * @param id - The text.
   */
  forget(id: ObjectId): void {
    this.waiting.delete(id);
    if (this.drawn.delete(id)) this.drawnVersion += 1;
  }

  /** Forgets every text. */
  clear(): void {
    this.waiting.clear();
    this.drawn.clear();
    this.drawnVersion += 1;
  }

  private createSource(): VectorGlyphSource {
    const source: VectorGlyphSource = new VectorGlyphSource({
      pool: this.resources.jobs,
      fonts: this.resources.fonts,
      onGeometryReady: () => {
        // A dropped source's late batches change nothing drawn.
        if (source !== this.source) return;
        this.landings += 1;
        for (const id of this.waiting) this.landed.add(id);
        this.requestFrame();
      },
    });
    return source;
  }
}

/** Each scene's text vector state, by the environment its passes are created with. */
const STATES = new WeakMap<ScenePassEnvironment, TextVectorState>();

/**
 * Creates the text pass's vector state when its resources ask for vector glyphs and it is the
 * text kind's pass, and registers it for the scene's `textVector` companion
 * ({@link textVectorOf}), which the standard passes create next from the same environment.
 *
 * @param environment - The scene's pass environment.
 * @param resources - The text pass's resources.
 * @param isTextKind - Whether the pass is the text kind's (frame titles never reach the tier).
 * @param landed - The pass's texts to rewrite, where those whose geometry landed go.
 * @returns The state, or `undefined` when the pass draws no vector glyphs.
 */
export function registerTextVector(
  environment: ScenePassEnvironment,
  resources: TextPassResources,
  isTextKind: boolean,
  landed: Set<ObjectId>,
): TextVectorState | undefined {
  if (!isTextKind || resources.hasVectorGlyphs !== true) return undefined;
  const state = new TextVectorState(resources, landed, environment.requestFrame);
  STATES.set(environment, state);
  return state;
}

/**
 * The vector state of the text pass created from an environment, if it draws vector glyphs.
 *
 * @param environment - The scene's pass environment.
 * @returns The state, or `undefined`.
 */
export function textVectorOf(environment: ScenePassEnvironment): TextVectorState | undefined {
  return STATES.get(environment);
}
