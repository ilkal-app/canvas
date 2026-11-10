import type { ReactElement } from 'react';

import { useWhiteboardChrome } from '../shell/whiteboard-chrome.js';

import { ICON_PATHS, type IconName } from './icon-paths.js';
import styles from './icon.module.css';
import { LIBRARY_ICON_PATHS } from './library-icon-paths.js';

/**
 * Every icon's size in CSS px (UI-18; the design as scaled up on 2026-10-06, was 16):
 * one size for the whole app, so no screen draws its own, but for the dock's tool buttons
 * ({@link DOCK_ICON_SIZE_PX}), the search field's glass ({@link SEARCH_ICON_SIZE_PX}) and the
 * site's small icons ({@link SITE_ICON_SIZE_PX}).
 */
export const ICON_SIZE_PX = 20;

/**
 * The icon size in the dock's tool buttons and its mode switcher, CSS px (the owner's calls of
 * 2026-10-07, and): the one exception to {@link ICON_SIZE_PX}, asked for through
 * {@link IconProps.size} and never by a stylesheet (`icon-usage.test.ts`). The buttons stay 40 px.
 */
export const DOCK_ICON_SIZE_PX = 24;

/**
 * The search field's magnifier, CSS px (frames H1 and H7: the glass drawn 13 px across, its 12-unit
 * drawing in a 17 px box): an exception to {@link ICON_SIZE_PX}, asked
 * for through {@link IconProps.size}.
 */
export const SEARCH_ICON_SIZE_PX = 17;

/**
 * The site's small icons, CSS px: the cards' star and ⋯, the view
 * toggle's grid and list, the sort's caret and the links' arrows, drawn about 11 px as the MVP
 * frames draw their glyphs. An exception to {@link ICON_SIZE_PX}, asked for through
 * {@link IconProps.size}; the stroke stays {@link ICON_STROKE_PX}.
 */
export const SITE_ICON_SIZE_PX = 16;

/**
 * The sizes an icon may be drawn at, CSS px: {@link ICON_SIZE_PX}, {@link DOCK_ICON_SIZE_PX},
 * {@link SEARCH_ICON_SIZE_PX} or {@link SITE_ICON_SIZE_PX}.
 */
export type IconSize =
  | typeof ICON_SIZE_PX
  | typeof DOCK_ICON_SIZE_PX
  | typeof SEARCH_ICON_SIZE_PX
  | typeof SITE_ICON_SIZE_PX;

/** Every icon's stroke in CSS px, whatever it is drawn on (UI-18; was 1.07). */
export const ICON_STROKE_PX = 1.5;

/** Props of {@link Icon}. */
export interface IconProps {
  /** Which icon. */
  readonly name: IconName;
  /**
   * Its size, CSS px; default {@link ICON_SIZE_PX}. Only the dock's tool buttons and mode switcher
   * pass {@link DOCK_ICON_SIZE_PX}, the search field {@link SEARCH_ICON_SIZE_PX}, and the site's
   * small icons {@link SITE_ICON_SIZE_PX} (`icon-usage.test.ts` holds every other icon to the
   * default).
   */
  readonly size?: IconSize | undefined;
}

/**
 * One of the app's outline icons, the only way the app draws one (`icon-usage.test.ts` rejects
 * any other): {@link ICON_SIZE_PX} square (or its `size`), its 16-unit drawing scaled to that size with the
 * stroke kept at {@link ICON_STROKE_PX} (`non-scaling-stroke`), in the text colour. Decorative
 * (`aria-hidden`): every control that shows one is named. Under the floating whiteboard chrome
 * it draws the design Library's vector ({@link LIBRARY_ICON_PATHS}) where the Library has one;
 * the classic chrome draws `ICON_PATHS`.
 *
 * @param props - Which icon, and its size if not the default.
 * @returns The icon.
 */
export function Icon(props: IconProps): ReactElement {
  const size = props.size ?? ICON_SIZE_PX;
  const isFloating = useWhiteboardChrome() === 'floating';
  const d = (isFloating ? LIBRARY_ICON_PATHS[props.name] : undefined) ?? ICON_PATHS[props.name];
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      data-icon={props.name}
    >
      <path d={d} strokeWidth={ICON_STROKE_PX} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
