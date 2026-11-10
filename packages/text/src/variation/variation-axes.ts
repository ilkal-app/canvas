/** One axis of a variable font (OpenType `fvar`). */
export interface VariationAxis {
  /** The axis tag, four characters (`wght`, `wdth`, `opsz`, a custom tag). */
  readonly tag: string;
  /** The axis's least value, in user units. */
  readonly minimum: number;
  /** The value the font's default outlines are drawn at. */
  readonly default: number;
  /** The axis's greatest value. */
  readonly maximum: number;
  /** Its name from the font's `name` table; its tag when the font names it nothing. */
  readonly name: string;
  /** Whether the font asks for the axis to be left out of user interfaces. */
  readonly isHidden: boolean;
}

/** A named instance of a variable font: a style the font defines by coordinates. */
export interface NamedInstance {
  /** Its style name ("Bold", "Condensed Light"); empty when the font names it nothing. */
  readonly name: string;
  /** Its coordinate on each axis, by tag. */
  readonly coordinates: Readonly<Record<string, number>>;
  /** Its PostScript name, when the font gives one. */
  readonly postScriptName?: string;
}

/** What a variable font offers: its axes and named instances. */
export interface VariationAxes {
  /** The axes, in the font's order. */
  readonly axes: readonly VariationAxis[];
  /** The named instances, in the font's order. */
  readonly instances: readonly NamedInstance[];
}
