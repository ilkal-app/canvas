// The icon rule (UI-18): every icon in the app is 20 px with a 1.5 px stroke, drawn by
// the one shared `Icon`, but for the dock's tool buttons and its mode switcher, whose icons are
// 24 px (the owner's calls of 2026-10-07, and), the search field's glass (frames H1
// and H7, and), and the site's small icons, through `Icon`'s `size` prop. This
// rejects any other way of drawing or sizing one, in the manner of theme/token-usage.test.ts: an
// `<svg>` written in a component, a `size` given to `Icon` anywhere but the dock's tool button and
// mode switcher, a stroke width set in a component or a stylesheet, or a stylesheet resizing an
// `svg`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The package's `src/` folder. */
const SRC = fileURLToPath(new URL('..', import.meta.url));

// Every component of the package, as text (tests aside), by its path from `src/` (`../x/y.tsx`).
// Read from disk, not imported as `?raw` modules: each such module counted as a second, never
// called copy of its component in the coverage report, and the app's functions floor failed
// whenever those copies outlived the merge.
const COMPONENTS: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx'))
    .map((path) => [`../${path.split('\\').join('/')}`, readFileSync(join(SRC, path), 'utf8')]),
);

// Every component stylesheet, as text.
const STYLESHEETS = import.meta.glob<string>('../**/*.module.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The one component that draws icons. */
const ICON_COMPONENT = '../icons/icon.tsx';

/**
 * The components that size their icons, and the sizes they pass, in order: the dock's tool button
 * and its mode switcher's modes (item 12), both 24 px; the switcher went at the cutover.
 */
const SIZED_ICONS: Readonly<Record<string, readonly string[]>> = {
  '../toolbar/dock-button.tsx': ['size={DOCK_ICON_SIZE_PX}'],
  // The search field's glass as frames H1 and H7 draw it; the sort's caret and
  // the view toggle's grid and list at the site's small size.
  '../site/home-controls.tsx': [
    'size={SEARCH_ICON_SIZE_PX}',
    'size={SITE_ICON_SIZE_PX}',
    'size={SITE_ICON_SIZE_PX}',
  ],
  // The site's small icons, as the MVP frames draw their glyphs: a
  // card's star and ⋯, All templates' arrow, Use another email's arrow.
  '../site/card-meta.tsx': ['size={SITE_ICON_SIZE_PX}'],
  '../site/card-menu.tsx': ['size={SITE_ICON_SIZE_PX}'],
  '../site/home-lists.tsx': ['size={SITE_ICON_SIZE_PX}'],
  '../site/code-entry-card.tsx': ['size={SITE_ICON_SIZE_PX}'],
  // The phone's floating New board's plus.
  '../site/home-account.tsx': ['size={SITE_ICON_SIZE_PX}'],
  // Settings' Back to boards arrow and Plan and billing's Manage billing ↗.
  '../site/settings-nav.tsx': ['size={SITE_ICON_SIZE_PX}'],
  '../site/plan-billing-page.tsx': ['size={SITE_ICON_SIZE_PX}'],
};

/**
 * Pictures that are not icons, by file, with the `<svg>`s each may hold and why: a mode's
 * thumbnail is an illustration of the mode, 160 × 100, not an icon; a sign-in provider's logo is
 * its brand mark, drawn in the brand's colours; Ilkal's loading bar is its long woven form; the
 * comparison's parity chart is a chart.
 */
const ILLUSTRATIONS: Readonly<Record<string, { readonly count: number; readonly why: string }>> = {
  '../brand/woven-progress.tsx': {
    count: 1,
    why: "Ilkal's long woven form as the loading bar, in Gulabi (Phase 1b)",
  },
  '../site/mode-art.tsx': { count: 1, why: 'the mode thumbnails' },
  '../site/parity-chart.tsx': {
    count: 2,
    why: "the comparison's parity chart and its legend's line samples",
  },
  '../site/provider-logos.tsx': {
    count: 2,
    why: "Google's and Microsoft's brand marks on the sign-in buttons, in their own colours",
  },
};

/** An illustration's own strokes, by selector: the mode thumbnails' and the parity chart's `art…` classes. */
const ILLUSTRATION_SELECTOR = /^\.art[A-Z]?\w*$/;

const RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;

/**
 * Every `<Icon …>` opening tag in a component's source, whole. The tag ends at the first `>` outside
 * any `{…}` expression and any quoted string, so a `>` inside an attribute (an arrow function, a
 * comparison, a string) does not cut it short.
 *
 * @param source - The component's source.
 * @returns The tags, in order.
 */
function iconTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<Icon\b/g)) {
    let depth = 0;
    let quote: string | undefined;
    for (let index = match.index + match[0].length; index < source.length; index += 1) {
      const char = source[index];
      if (quote !== undefined) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      } else if (char === '>' && depth === 0) {
        tags.push(source.slice(match.index, index + 1));
        break;
      }
    }
  }
  return tags;
}

describe('the icon rule', () => {
  it('finds the components and stylesheets, so the checks below are not vacuous', () => {
    expect(Object.keys(COMPONENTS)).toContain(ICON_COMPONENT);
    expect(Object.keys(COMPONENTS).length).toBeGreaterThan(50);
    expect(Object.keys(STYLESHEETS).length).toBeGreaterThan(10);
  });

  it('draws no <svg> outside the shared Icon, but for the listed illustrations', () => {
    for (const [path, source] of Object.entries(COMPONENTS)) {
      if (path === ICON_COMPONENT) continue;
      const count = source.match(/<svg\b/g)?.length ?? 0;
      expect(count, `${path} draws its own svg; use Icon`).toBe(ILLUSTRATIONS[path]?.count ?? 0);
    }
  });

  it('sizes an icon only through Icon’s size prop, and only in the listed components', () => {
    for (const [path, source] of Object.entries(COMPONENTS)) {
      const sizes = iconTags(source).flatMap(
        (element) => /\bsize=\{[^}]*\}|\bsize=\S+/.exec(element)?.[0] ?? [],
      );
      expect(sizes, `${path} sizes its icons; only the listed components may`).toEqual(
        SIZED_ICONS[path] ?? [],
      );
    }
    // Every listed component exists, in the folders this checkout carries: the public repository's
    // export carries the shell without the site's folders.
    const carried = Object.keys(SIZED_ICONS).filter((path) =>
      existsSync(join(SRC, path.split('/')[1] ?? '')),
    );
    for (const path of carried) expect(Object.keys(COMPONENTS)).toContain(path);
  });

  it('gives Icon no prop spread and never creates it by hand, so a size cannot slip past', () => {
    for (const [path, source] of Object.entries(COMPONENTS)) {
      for (const element of iconTags(source)) {
        expect(element, `${path} spreads props into Icon; pass each prop by name`).not.toMatch(
          /\{\s*\.\.\./,
        );
      }
      expect(source, `${path} creates Icon by hand; use <Icon />`).not.toMatch(
        /createElement\(\s*Icon\b/,
      );
    }
  });

  it('sets no stroke width in a component outside the shared Icon', () => {
    for (const [path, source] of Object.entries(COMPONENTS)) {
      if (path === ICON_COMPONENT) continue;
      expect(/\bstrokeWidth=|\bvectorEffect=/.exec(source)?.[0], path).toBeUndefined();
    }
  });

  it('sets no stroke width in a stylesheet but for an illustration’s strokes', () => {
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector = '', body = ''] of withoutComments.matchAll(RULE_PATTERN)) {
        if (!/\bstroke-width\s*:/.test(body)) continue;
        const selectors = selector.split(',').map((part) => part.trim());
        expect(
          selectors.every((part) => ILLUSTRATION_SELECTOR.test(part)),
          `${path} ${selector.trim()}`,
        ).toBe(true);
      }
    }
  });

  it('never resizes, fills or restrokes an svg from a stylesheet', () => {
    for (const [path, css] of Object.entries(STYLESHEETS)) {
      const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector = '', body = ''] of withoutComments.matchAll(RULE_PATTERN)) {
        if (!/(?:^|[\s,>+~])(?:svg|path)\b/.test(selector)) continue;
        expect(
          /\b(?:width|height|stroke|stroke-width|fill)\s*:/.exec(body)?.[0],
          `${path} ${selector.trim()}`,
        ).toBeUndefined();
      }
    }
  });
});
