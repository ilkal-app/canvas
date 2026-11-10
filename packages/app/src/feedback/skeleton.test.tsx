// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton.js';
import skeletonCss from './skeleton.module.css?raw';

afterEach(cleanup);

/**
 * The one skeleton rendered.
 *
 * @param container - Where it was rendered.
 * @returns Its element.
 */
function skeletonIn(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

describe('Skeleton', () => {
  it('is a bar of the size asked, hidden from assistive technology', () => {
    const { container } = render(<Skeleton width={120} height={10} />);
    const bar = skeletonIn(container);
    expect(bar.style.width).toBe('120px');
    expect(bar.style.height).toBe('10px');
    expect(bar.dataset.shape).toBe('bar');
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.dataset.inline).toBeUndefined();
  });

  it('takes CSS lengths, a block shape, a place in a line and the screen’s class', () => {
    const { container } = render(
      <Skeleton width="60%" shape="block" isInline className="thumbnail" />,
    );
    const block = skeletonIn(container);
    expect(block.style.width).toBe('60%');
    expect(block.style.height).toBe('');
    expect(block.dataset.shape).toBe('block');
    expect(block.dataset.inline).toBe('');
    expect(block.classList.contains('thumbnail')).toBe(true);
  });

  it('is static on the raised surface, a bar with the control’s corners, a block the sheet’s', () => {
    expect(skeletonCss).not.toMatch(/animation|transition|@keyframes/);
    expect(skeletonCss).toMatch(
      /\.skeleton \{[^}]*border-radius: var\(--radius-control\);[^}]*background: var\(--color-surface-raised\);/,
    );
    expect(skeletonCss).toMatch(
      /\.skeleton\[data-shape='block'\] \{\s*border-radius: var\(--radius-sheet\);/,
    );
  });
});
