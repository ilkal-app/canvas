// Reactions are sharp at every device pixel ratio: the floating emoji is text set at the
// size it shows, twice the Title style's, never drawn small and scaled up. A browser draws an
// animated layer once at its own size, so a scaled emoji was a stretched bitmap, soft on an iPad's
// 2x screen; text set at its size is drawn at the device's resolution.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SCALE_TOKENS } from '../theme/scale-tokens.js';
import { TEXT_STYLES } from '../theme/text-styles.js';

/** The reaction layer's stylesheet, read as it ships. */
const CSS = readFileSync(new URL('./reaction-layer.module.css', import.meta.url), 'utf8');

/**
 * The declarations of the rule whose selector is exactly the one given.
 *
 * @param css - The stylesheet.
 * @param selector - The selector.
 * @returns Its declarations; empty when there is none.
 */
function ruleOf(css: string, selector: string): string {
  const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  for (const [, found = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (found.trim() === selector) return body;
  }
  return '';
}

describe('a reaction’s resolution', () => {
  it('is set at twice the Title size, not scaled', () => {
    expect(SCALE_TOKENS['--reaction-size']).toBe(`${String(TEXT_STYLES.title.sizePx * 2)}px`);
    expect(SCALE_TOKENS['--reaction-line-height']).toBe(
      `${String(TEXT_STYLES.title.lineHeightPx * 2)}px`,
    );
    const reaction = ruleOf(CSS, '.reaction');
    expect(reaction).toContain('font-size: var(--reaction-size);');
    expect(reaction).toContain('line-height: var(--reaction-line-height);');
    expect(reaction).not.toMatch(/\bscale\s*:/);
    expect(reaction).not.toMatch(/scale\(/);
  });

  it('animates only its place and its opacity', () => {
    const keyframes = /@keyframes[\s\S]*$/.exec(CSS.replaceAll(/\/\*[\s\S]*?\*\//g, ''))?.[0];
    expect(keyframes).toBeDefined();
    expect(keyframes).not.toMatch(/\bscale\b|\bzoom\b|\btransform\s*:/);
  });
});
