import { THEMES, type ThemeName } from './theme-tokens.js';

/**
 * Applies a theme to an element: every token as a CSS custom property, `data-theme` for
 * theme-specific selectors, and `color-scheme` so native controls and scrollbars match.
 * Descendants inherit the tokens. The shell applies it to its own root element rather than the
 * document, so an embedding page (the embeddable SDK) keeps its own styles.
 *
 * @param element - The element whose subtree takes the theme.
 * @param themeName - The theme to apply.
 */
export function applyTheme(element: HTMLElement, themeName: ThemeName): void {
  for (const [name, value] of Object.entries(THEMES[themeName])) {
    element.style.setProperty(name, value);
  }
  element.dataset.theme = themeName;
  element.style.colorScheme = themeName;
}
