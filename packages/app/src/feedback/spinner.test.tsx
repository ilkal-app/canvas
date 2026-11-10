// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Spinner } from './spinner.js';
import spinnerCss from './spinner.module.css?raw';

afterEach(cleanup);

describe('Spinner', () => {
  it('is 16 px by default and takes the sheet’s other sizes, hidden from assistive technology', () => {
    const { container, rerender } = render(<Spinner />);
    const spinner = container.firstElementChild as HTMLElement;
    expect(spinner.dataset.size).toBe('16');
    expect(spinner.getAttribute('aria-hidden')).toBe('true');
    for (const size of [12, 14, 24] as const) {
      rerender(<Spinner size={size} />);
      expect((container.firstElementChild as HTMLElement).dataset.size).toBe(String(size));
    }
  });

  it('draws each size with a stroke an eighth of it', () => {
    for (const [size, stroke] of [
      ['12', '1.5px'],
      ['14', '1.75px'],
      ['24', '3px'],
    ] as const) {
      const rule = new RegExp(
        `\\.spinner\\[data-size='${size}'\\] \\{[^}]*width: ${size}px;[^}]*height: ${size}px;[^}]*calc\\(100% - ${stroke.replace('.', '\\.')}\\)`,
      );
      expect(spinnerCss).toMatch(rule);
    }
    expect(spinnerCss).toMatch(/\.spinner \{[^}]*width: 16px;[^}]*calc\(100% - 2px\)/);
  });

  it('turns, and stops turning under the system’s reduced-motion setting', () => {
    expect(spinnerCss).toMatch(/\.spinner \{[^}]*animation: spinner-turn/);
    expect(spinnerCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.spinner \{\s*animation: none;/,
    );
  });
});
