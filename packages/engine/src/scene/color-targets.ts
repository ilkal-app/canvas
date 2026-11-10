import {
  backdropFillOf,
  containerTextMode,
  INK_COLORS,
  type BoardObject,
  type ColorMode,
  type ObjectId,
  type Paint,
  type Rgba,
} from '@canvas/schema';

import {
  ColorPalette,
  isSameRgba,
  isTokenUnchanged,
  NO_COLOR_TOKENS,
  type ColorTokenValues,
  type InkColors,
} from '../paint/color-palette.js';
import { colorTokensOf } from '../paint/paint-reading.js';

import {
  frameFillFallbackMode,
  isFrameFillFallback,
  type ColorModeFallbackOption,
  type FallbackMode,
  type FrameFillBackdrop,
} from './color-mode-fallback.js';
import type { SceneObject } from './scene-pass.js';
import type { SceneSource } from './scene-source.js';
import type { WorldTransform } from './world-transform.js';

/** The most ancestors a mode walk reads: deeper chains (or a loop a merge left) end it. */
const MAX_MODE_STEPS = 1024;

/** How a scene resolves colours at first. */
export interface ColorTargetsOptions {
  /** The viewer's theme. Default `light`. */
  readonly theme?: ColorMode;
  /** What ink draws as per theme. Default the schema's `INK_COLORS`. */
  readonly inkColors?: InkColors;
  /** What ink draws as at first in the viewer's theme, over `inkColors` (`Scene.setInk`). */
  readonly ink?: Rgba;
  /** The board's token values. Default none. */
  readonly colorTokens?: ColorTokenValues;
  /**
   * The colour mode where no ancestor sets one: a hook, or a built-in by name
   * (`'frame-fill-luminance'`: the nearest filled frame's luminance). Absent: none.
   */
  readonly colorModeFallback?: ColorModeFallbackOption;
}

/** An object drawn with `'ink'` or a token, as last applied. */
interface Kept {
  /** The target passes last prepared it from. */
  readonly target: SceneObject;
  /** The tokens it names (`'ink'` for the literal). */
  readonly tokens: ReadonlySet<string>;
  /** Its mode when an ancestor-or-self or the fallback fixes one; undefined: the viewer's. */
  readonly fixedMode: ColorMode | undefined;
  /** What the frame-fill rule's mode read when it read a token. */
  readonly backdrop?: FrameFillBackdrop;
}

/** A target's palettes (`SceneObject.palette`, `textPalette`). */
interface Palettes {
  readonly palette: ColorPalette;
  readonly textPalette?: ColorPalette;
}

/**
 * Tells whether a target already has these palettes.
 *
 * @param target - The target.
 * @param palettes - The palettes.
 * @returns True when both are the same.
 */
function isSamePalettes(target: SceneObject, palettes: Palettes): boolean {
  return target.palette === palettes.palette && target.textPalette === palettes.textPalette;
}

/**
 * A target with these palettes, and no text palette unless they have one.
 *
 * @param target - The target.
 * @param palettes - The palettes.
 * @returns The new target.
 */
function withPalettes(target: SceneObject, palettes: Palettes): SceneObject {
  const { object, transform } = target;
  return { object, transform, ...palettes };
}

/**
 * A frame's, main's or instance's own explicit mode; an instance that sets none takes its main's
 * when the source holds it (`InstanceExpansion` shows an instance with its main's mode already).
 *
 * @param object - An object of any type.
 * @param source - The scene's source.
 * @returns The mode, or undefined.
 */
function ownMode(object: BoardObject, source: SceneSource): ColorMode | undefined {
  if (object.type !== 'frame' && object.type !== 'component' && object.type !== 'instance') {
    return undefined;
  }
  const { colorMode } = object as { readonly colorMode?: unknown };
  if (colorMode === 'light' || colorMode === 'dark') return colorMode;
  if (object.type !== 'instance') return undefined;
  const main = source.get(object.mainId);
  return main?.type === 'component' ? ownMode(main, source) : undefined;
}

/**
 * The scene's colour resolution (the ink targets, generalised to colour tokens): the
 * palette of each colour mode for the board's tokens and the viewer's ink, and the objects whose
 * records name `'ink'` or a token, each with the target it was last prepared from and its fixed
 * mode. A theme switch, a token edit or an ink change hands back only the targets whose colours
 * change, to be rewritten without reading the document, laying text out or meshing a path; a
 * `colorMode` change on an ancestor needs nothing here, since the scene refreshes descendants.
 * CPU-only; one per scene.
 */
export class ColorTargets {
  private theme: ColorMode;
  private inkColors: InkColors;
  private table: ColorTokenValues;
  private palettes: Readonly<Record<ColorMode, ColorPalette>>;
  private readonly fallback: ColorModeFallbackOption | undefined;
  private readonly kept = new Map<ObjectId, Kept>();
  /** The kept objects with a backdrop: a theme switch or token edit visits only these. */
  private readonly backdropped = new Set<ObjectId>();

  /**
   * Starts with a theme, ink colours and token values.
   *
   * @param options - The theme, ink colours, tokens and fallback hook.
   */
  constructor(options: ColorTargetsOptions = {}) {
    this.theme = options.theme ?? 'light';
    const inkColors = options.inkColors ?? INK_COLORS;
    this.inkColors = options.ink ? { ...inkColors, [this.theme]: options.ink } : inkColors;
    this.table = options.colorTokens ?? NO_COLOR_TOKENS;
    this.fallback = options.colorModeFallback;
    this.palettes = this.buildPalettes();
  }

  /**
   * The viewer's theme.
   *
   * @returns The theme.
   */
  get viewerTheme(): ColorMode {
    return this.theme;
  }

  /**
   * What ink draws as in the viewer's theme.
   *
   * @returns The colour.
   */
  get ink(): Rgba {
    return this.palettes[this.theme].ink;
  }

  /**
   * The board's token values the scene draws.
   *
   * @returns The table.
   */
  get colorTokens(): ColorTokenValues {
    return this.table;
  }

  /**
   * The objects drawn with ink or a token.
   *
   * @returns The count.
   */
  get size(): number {
    return this.kept.size;
  }

  /**
   * Builds the target a pass prepares an object from, keeping it when it names ink or a token,
   * with its mode: the nearest ancestor-or-self frame, main or instance with a `colorMode`
   * (virtual content walks its virtual parents to its instance), else the fallback hook, else
   * the viewer's theme.
   *
   * @param object - The object, as the scene applies it.
   * @param transform - Its world transform.
   * @param source - The scene's source, for its ancestors.
   * @returns The target, with its palette.
   */
  targetOf(object: BoardObject, transform: WorldTransform, source: SceneSource): SceneObject {
    const tokens = colorTokensOf(object);
    if (tokens === undefined) {
      this.forget(object.id);
      return { object, transform, palette: this.palettes[this.theme] };
    }
    const { mode: fixedMode, backdrop } = this.fixedModeOf(object, source);
    const target = { object, transform, ...this.palettesOf(object, fixedMode) };
    this.kept.set(object.id, { target, tokens, fixedMode, ...(backdrop && { backdrop }) });
    if (backdrop === undefined) this.backdropped.delete(object.id);
    else this.backdropped.add(object.id);
    return target;
  }

  /**
   * A target with its current palette: itself when it has it (a pass's own rewrite of a target
   * it kept from before a theme switch or token edit gets the current one).
   *
   * @param target - The target.
   * @returns The target with the current palette.
   */
  current(target: SceneObject): SceneObject {
    const kept = this.kept.get(target.object.id);
    const palettes = this.palettesOf(target.object, kept?.fixedMode);
    return isSamePalettes(target, palettes) ? target : withPalettes(target, palettes);
  }

  /**
   * Forgets an object that left the scene.
   *
   * @param id - The object.
   */
  forget(id: ObjectId): void {
    this.kept.delete(id);
    this.backdropped.delete(id);
  }

  /**
   * Switches the viewer's theme and, when given, the ink colours.
   *
   * @param theme - The viewer's theme.
   * @param inkColors - What ink draws as per theme; default the current ones.
   * @returns The targets to rewrite, with their new palettes.
   */
  setTheme(theme: ColorMode, inkColors: InkColors = this.inkColors): readonly SceneObject[] {
    const isInkSame =
      isSameRgba(inkColors.light, this.inkColors.light) &&
      isSameRgba(inkColors.dark, this.inkColors.dark);
    if (theme === this.theme && isInkSame) return [];
    this.theme = theme;
    this.inkColors = inkColors;
    if (!isInkSame) this.palettes = this.buildPalettes();
    // A frame-fill mode that resolved a token fill in the viewer's theme may change with it.
    // So may one whose token fills draw in the ink colours, when they changed (a token the board
    // lacks draws as ink too): every backdrop is worked out again then.
    const moved = this.refreshBackdrops((backdrop) => !isInkSame || backdrop.didReadViewerTheme);
    // An object in a fixed mode keeps its colours across a theme switch unless ink changed.
    if (moved.size === 0) return this.repaint((kept) => !isInkSame || kept.fixedMode === undefined);
    return this.repaint((kept, id) => !isInkSame || kept.fixedMode === undefined || moved.has(id));
  }

  /**
   * Changes what ink draws as in the viewer's theme.
   *
   * @param color - The new colour.
   * @returns The targets to rewrite.
   */
  setInk(color: Rgba): readonly SceneObject[] {
    return this.setTheme(this.theme, { ...this.inkColors, [this.theme]: color });
  }

  /**
   * Replaces the board's token values.
   *
   * @param table - The new values.
   * @returns The targets naming a token whose colour changed in either mode, to rewrite.
   */
  setTokens(table: ColorTokenValues): readonly SceneObject[] {
    const before = this.palettes;
    this.table = table;
    this.palettes = this.buildPalettes();
    const changed = new Map<string, boolean>();
    const isChanged = (id: string): boolean => {
      let is = changed.get(id);
      if (is === undefined) {
        is = !isTokenUnchanged(id, before, this.palettes);
        changed.set(id, is);
      }
      return is;
    };
    // A frame-fill mode that read a changed token fill may change with it.
    const moved = this.refreshBackdrops((backdrop) => [...backdrop.tokens].some(isChanged));
    const namesChanged = (kept: Kept): boolean => {
      for (const id of kept.tokens) if (isChanged(id)) return true;
      return false;
    };
    if (moved.size === 0) return this.repaint(namesChanged);
    return this.repaint((kept, objectId) => moved.has(objectId) || namesChanged(kept));
  }

  private buildPalettes(): Readonly<Record<ColorMode, ColorPalette>> {
    return {
      light: new ColorPalette('light', this.table, this.inkColors),
      dark: new ColorPalette('dark', this.table, this.inkColors),
    };
  }

  private repaint(isAffected: (kept: Kept, id: ObjectId) => boolean): SceneObject[] {
    const rewritten: SceneObject[] = [];
    for (const [id, kept] of this.kept) {
      const palettes = this.palettesOf(kept.target.object, kept.fixedMode);
      if (isSamePalettes(kept.target, palettes) || !isAffected(kept, id)) continue;
      const target = withPalettes(kept.target, palettes);
      this.kept.set(id, { ...kept, target });
      rewritten.push(target);
    }
    return rewritten;
  }

  /**
   * Works the frame-fill mode out again, from the kept fills, for the kept objects whose backdrop
   * a change may move (a theme switch, a token edit), without reading the document.
   *
   * @param isAffected - Whether a backdrop depends on what changed.
   * @returns The objects whose fixed mode changed.
   */
  private refreshBackdrops(isAffected: (backdrop: FrameFillBackdrop) => boolean): Set<ObjectId> {
    const moved = new Set<ObjectId>();
    for (const id of this.backdropped) {
      const kept = this.kept.get(id);
      if (kept?.backdrop === undefined || !isAffected(kept.backdrop)) continue;
      const { mode, backdrop } = frameFillFallbackMode(
        kept.backdrop.fills,
        this.theme,
        this.table,
        this.inkColors,
      );
      this.kept.set(id, { ...kept, fixedMode: mode, ...(backdrop && { backdrop }) });
      if (mode !== kept.fixedMode) moved.add(id);
    }
    return moved;
  }

  /**
   * An object's palettes in a mode: its mode's, and for a filled container whose fill decides
   * another mode for its text (`containerTextMode`) that mode's as its text palette.
   *
   * @param object - The object.
   * @param fixedMode - Its fixed mode; undefined: the viewer's theme.
   * @returns The palettes.
   */
  private palettesOf(object: BoardObject, fixedMode: ColorMode | undefined): Palettes {
    const mode = fixedMode ?? this.theme;
    const palette = this.palettes[mode];
    const options = { tokens: this.table, inkColors: this.inkColors };
    const textMode = containerTextMode(object, mode, options) ?? mode;
    return textMode === mode ? { palette } : { palette, textPalette: this.palettes[textMode] };
  }

  private fixedModeOf(object: BoardObject, source: SceneSource): FallbackMode {
    const fills: (Paint | null)[] = [];
    let node: BoardObject | undefined = object;
    for (let step = 0; node !== undefined && step < MAX_MODE_STEPS; step += 1) {
      const mode = ownMode(node, source);
      if (mode !== undefined) return { mode };
      if (step > 0) fills.push(backdropFillOf(node));
      node = node.parentId === null ? undefined : source.get(node.parentId);
    }
    if (isFrameFillFallback(this.fallback)) {
      return frameFillFallbackMode(fills, this.theme, this.table, this.inkColors);
    }
    if (typeof this.fallback !== 'function') return { mode: undefined };
    return { mode: this.fallback(object, { objects: source }) };
  }
}

/**
 * The colour options among a larger set (a renderer's): the theme, ink colours, ink, token values
 * and fallback hook it was given, and nothing it was not.
 *
 * @param options - Options that may carry colour options.
 * @returns The colour options alone.
 */
export function colorOptionsOf(options: ColorTargetsOptions): ColorTargetsOptions {
  const { theme, inkColors, ink, colorTokens, colorModeFallback } = options;
  return {
    ...(theme && { theme }),
    ...(inkColors && { inkColors }),
    ...(ink && { ink }),
    ...(colorTokens && { colorTokens }),
    ...(colorModeFallback && { colorModeFallback }),
  };
}
