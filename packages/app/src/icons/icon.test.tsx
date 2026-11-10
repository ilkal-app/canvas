// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { whiteboardChromeContext } from '../shell/whiteboard-chrome.js';

import { ICON_PATHS, type IconName } from './icon-paths.js';
import {
  DOCK_ICON_SIZE_PX,
  ICON_SIZE_PX,
  ICON_STROKE_PX,
  Icon,
  SEARCH_ICON_SIZE_PX,
  SITE_ICON_SIZE_PX,
} from './icon.js';
import { LIBRARY_ICON_PATHS } from './library-icon-paths.js';

afterEach(cleanup);

describe('Icon', () => {
  it('is one size and one stroke for the whole app: 20 px, 1.5 px (UI-18), 24 px in the dock', () => {
    expect(ICON_SIZE_PX).toBe(20);
    expect(ICON_STROKE_PX).toBe(1.5);
    // The dock's tool buttons only (icon-usage.test.ts).
    expect(DOCK_ICON_SIZE_PX).toBe(24);
    // The search glass, 13 px across, and the site's small icons (the owner's calls).
    expect(SEARCH_ICON_SIZE_PX).toBe(17);
    expect(SITE_ICON_SIZE_PX).toBe(16);
  });

  it('draws at the dock’s 24 px when asked, the drawing scaled and the stroke kept at 1.5 px', () => {
    const { container } = render(<Icon name="note" size={DOCK_ICON_SIZE_PX} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('stroke-width')).toBe('1.5');
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it.each(Object.keys(ICON_PATHS) as IconName[])(
    'draws %s 20 px square with a 1.5 px stroke that does not scale, decorative',
    (name) => {
      const { container } = render(<Icon name={name} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.getAttribute('height')).toBe('20');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('focusable')).toBe('false');
      expect(svg?.dataset.icon).toBe(name);
      const paths = svg?.querySelectorAll('path') ?? [];
      expect(paths).toHaveLength(1);
      expect(paths[0]?.getAttribute('stroke-width')).toBe('1.5');
      expect(paths[0]?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(paths[0]?.getAttribute('d')).toBe(ICON_PATHS[name]);
    },
  );

  it('draws every icon as strokes only, with no fill', () => {
    for (const d of Object.values(ICON_PATHS)) expect(d).toMatch(/^M/);
  });
});

describe('Icon under the floating chrome', () => {
  it('draws the Library’s vector under the floating chrome and ICON_PATHS under the classic one', () => {
    const floating = render(
      <whiteboardChromeContext.Provider value="floating">
        <Icon name="check" />
      </whiteboardChromeContext.Provider>,
    );
    expect(floating.container.querySelector('path')?.getAttribute('d')).toBe(
      LIBRARY_ICON_PATHS.check,
    );
    floating.unmount();
    const classic = render(<Icon name="check" />);
    expect(classic.container.querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.check);
  });

  it('keeps the app’s drawing for an icon the Library has none of, at the same size and stroke', () => {
    const { container } = render(
      <whiteboardChromeContext.Provider value="floating">
        <Icon name="send" />
      </whiteboardChromeContext.Provider>,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(ICON_PATHS.send);
    expect(svg?.querySelector('path')?.getAttribute('stroke-width')).toBe('1.5');
  });
});
