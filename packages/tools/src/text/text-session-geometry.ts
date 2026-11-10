import { caretRect, type TextLayout } from '@canvas/engine';
import {
  containerTextMode,
  effectiveColorMode,
  frameFillFallback,
  resolveColor,
  resolveInk,
  type ColorModeBoard,
  type InkTheme,
  type Point,
  type Rgba,
  type TextStyle,
  type TokenTable,
} from '@canvas/schema';

import type { OrientedBox } from '../select/oriented-box.js';
import { textHighlightOf, type OverlayPalette } from '../select/overlay-palette.js';
import type { OverlayRect } from '../select/overlay-rects.js';

import { insertStyleOf, selectionRange } from './editor-state.js';
import {
  editedBoxRect,
  editedHitRect,
  rectToWorld,
  textOriginIn,
  worldToLocal,
  type LocalRect,
} from './text-box-frame.js';
import type { EditableTextObject } from './text-box-object.js';
import { textEditingRects } from './text-editing-rects.js';
import type { TextEditingSession } from './text-session.js';

/**
 * Whether a world point is on an edited box (its text box, grown by a margin; a shape's label
 * lines where they overflow it too, `editedHitRect`), where a press moves the caret rather than
 * ending the session.
 *
 * @param session - The session.
 * @param world - The point, world units.
 * @param margin - How far outside the box still counts, world units.
 * @returns Whether it is on the box.
 */
export function isOnSessionBox(session: TextEditingSession, world: Point, margin: number): boolean {
  const object = session.object();
  const frame = session.frame();
  if (object === undefined || frame === undefined) return false;
  const rect = sessionHitRect(object, session.layout());
  if (rect === undefined) return false;
  const local = worldToLocal(frame, world);
  return (
    local.x >= rect.x - margin &&
    local.y >= rect.y - margin &&
    local.x <= rect.x + rect.width + margin &&
    local.y <= rect.y + rect.height + margin
  );
}

/**
 * Where presses on an edited object go to the editor: its hit rectangle (`editedHitRect`), or,
 * while no font lays the text out, its stored box; a connector's label has none then.
 *
 * @param object - The edited object.
 * @param layout - Its content's layout, if a font lays it out.
 * @returns The rectangle in the object's frame, or `undefined`.
 */
function sessionHitRect(
  object: EditableTextObject,
  layout: TextLayout | undefined,
): LocalRect | undefined {
  if (layout !== undefined) return editedHitRect(object, layout);
  if (object.type === 'connector') return undefined;
  return { x: 0, y: 0, width: object.width, height: object.height };
}

/**
 * The caret's line box in the world, for placing an input method's window by it: while composing,
 * at the input method's caret or the start of its target segment.
 *
 * @param session - The session.
 * @returns A zero-width box at the caret, turned with the object; `undefined` while the text
 *   cannot be laid out.
 */
export function sessionCaretBox(session: TextEditingSession): OrientedBox | undefined {
  const object = session.object();
  const layout = session.layout();
  const frame = session.frame();
  if (object === undefined || layout === undefined || frame === undefined) return undefined;
  const origin = textOriginIn(object, layout);
  const caret = caretRect(
    layout,
    session.displayed().compositionSelection?.[0] ?? session.editor.caret,
  );
  return rectToWorld(frame, { ...caret, x: origin.x + caret.x, y: origin.y + caret.y, width: 0 });
}

/** The board the edited object is on, for its caret's colour. */
export interface CaretColors {
  /** The board's colour token table. */
  readonly tokens: TokenTable;
  /** The board, whose frames, mains and instances set the object's colour mode. */
  readonly board: ColorModeBoard;
}

/**
 * The caret's colour: the text's as drawn, in the object's colour mode (the frame-fill
 * fallback's when no ancestor sets one), or in the mode its own fill gives a sticky's or filled shape's text.
 *
 * @param object - The edited object.
 * @param color - The colour typing inserts.
 * @param theme - The viewer's theme.
 * @param colors - The board's tokens and objects, if known.
 * @returns The colour.
 */
function caretColorOf(
  object: EditableTextObject,
  color: TextStyle['color'],
  theme: InkTheme,
  colors: CaretColors | undefined,
): Rgba {
  const options = colors === undefined ? {} : { tokens: colors.tokens };
  // The frame-fill fallback, as the renderer selects it.
  const fillMode =
    colors === undefined
      ? theme
      : effectiveColorMode(object, colors.board, {
          viewerTheme: theme,
          fallbackMode: frameFillFallback({ viewerTheme: theme, ...options }),
        });
  const mode = containerTextMode(object, fillMode, options) ?? fillMode;
  return colors === undefined ? resolveInk(color, mode) : resolveColor(color, mode, colors.tokens);
}

/**
 * An editing session's overlay: the box's outline, the selection, the composition and the caret.
 *
 * @param session - The session.
 * @param zoom - The camera zoom.
 * @param theme - The viewer's theme, which an `ink` caret is drawn in; light if absent.
 * @param palette - The editing states' colours: the outline in its `you` and the
 *   selection highlighted in it; the selection blue if absent.
 * @param colors - The board's tokens and objects: the caret takes the text's colour as
 *   drawn, a token in the object's colour mode; without them, `ink` in the theme and a token at
 *   its built-in default.
 * @returns The rectangles, world units.
 */
export function sessionOverlayRects(
  session: TextEditingSession,
  zoom: number,
  theme: InkTheme = 'light',
  palette?: OverlayPalette,
  colors?: CaretColors,
): OverlayRect[] {
  const object = session.object();
  const frame = session.frame();
  const layout = session.layout();
  if (object === undefined || frame === undefined || layout === undefined) return [];
  const box = editedBoxRect(object, layout);
  const origin = textOriginIn(object, layout);
  const shown = session.displayed();
  const state = session.editor;
  const caret = shown.composition ? shown.composition[1] : state.caret;
  return textEditingRects({
    layout,
    box,
    // Where the text starts in the box (a connector's label box is placed away from its origin).
    textOrigin: { x: origin.x - box.x, y: origin.y - box.y },
    transform: frame,
    selection: shown.composition ? [caret, caret] : selectionRange(state),
    caret,
    composition: shown.composition,
    compositionSelection: shown.compositionSelection,
    caretColor: caretColorOf(object, insertStyleOf(state).color, theme, colors),
    zoom,
    ...(palette === undefined
      ? {}
      : { outlineColor: palette.you, highlightColor: textHighlightOf(palette) }),
  });
}
