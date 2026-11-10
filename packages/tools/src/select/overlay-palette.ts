import type { Rgba } from '@canvas/schema';

/**
 * The colours of the editing states (Figma "States" E1–E3) for the viewer's theme, which
 * the shell resolves from its colour tokens and sends with the overlay's model
 * (`SelectionOverlayModel.palette`) and gives the text mode (`CreationInkSource.overlayPalette`).
 * Each is straight alpha, channels in [0, 1]. Without a palette the overlay keeps its own
 * colours (the selection blue, the guides' red, the lock grey) and a solid lock outline.
 */
export interface OverlayPalette {
  /**
   * `hand/you`: the outline of the text being edited, its selection highlight (at a third) and
   * the size readout's pill.
   */
  readonly you: Rgba;
  /** `mark/red-pencil`: the alignment guides and the gap runs between objects. */
  readonly guide: Rgba;
  /** `ink/secondary`: the outline of the object under a resting pointer. */
  readonly hover: Rgba;
  /** `ink/faint`: the dashed outline of a locked selection. */
  readonly locked: Rgba;
  /**
   * The whiteboard design's selection, which the shell sends only under the floating
   * whiteboard chrome: the frame outlined two CSS px wide, two px outside the selection, with
   * square handles three px out of its corners and edges, and the overlay's other marks in the
   * selection colour (`overlayRectsOf`). Absent, the classic selection: one px outlines and white
   * handles in the selection blue.
   */
  readonly selection?: SelectionStyle;
}

/** The colours of the whiteboard design's selection (`OverlayPalette.selection`). */
export interface SelectionStyle {
  /**
   * `hand/you`: each outline of a multi-selection, the marquee (its fill at an eighth), the drop
   * target, the insertion line and the count badge.
   */
  readonly color: Rgba;
  /**
   * `--color-selection`: the frame's outline and the handles' edges, which the board shows round
   * the selection (`hand/you`, darkened in Vellum to keep 3:1 on the mat).
   */
  readonly frameColor: Rgba;
  /** `surface/sheet`: the inside of a handle. */
  readonly handleFill: Rgba;
}

/** How strong the text selection highlight is over the palette's `you`, as alpha. */
export const TEXT_HIGHLIGHT_ALPHA = 0.35;

/**
 * The text selection highlight of a palette: its `you` at {@link TEXT_HIGHLIGHT_ALPHA}.
 *
 * @param palette - The palette.
 * @returns The highlight's colour.
 */
export function textHighlightOf(palette: OverlayPalette): Rgba {
  const [red, green, blue] = palette.you;
  return [red, green, blue, TEXT_HIGHLIGHT_ALPHA];
}
