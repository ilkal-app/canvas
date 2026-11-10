// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openLink } from './open-link.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openLink acceptance', () => {
  it.each(['https://example.com/', 'http://example.com/path', 'mailto:hello@example.com'])(
    'opens canonical destination %s exactly once with isolation features',
    (link) => {
      const open = vi.fn();

      expect(openLink(link, open)).toBe(true);
      expect(open).toHaveBeenCalledExactlyOnceWith(link, '_blank', 'noopener,noreferrer');
    },
  );

  it.each([
    'javascript:alert(1)',
    'https://u:p@example.com/',
    'mailto:a@example.com?bcc=c@example.com',
    ' https://example.com/',
  ])('refuses unsafe or noncanonical stored link %s', (link) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    expect(openLink(link)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('uses window.open when no opener is passed', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    expect(openLink('https://example.com/')).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
