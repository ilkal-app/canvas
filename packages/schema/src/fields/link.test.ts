// An object's link: a link that fits the cap as typed but not once the URL parser
// escapes it is refused, so no stored link is longer than LINK_MAX_LENGTH.
import { describe, expect, it } from 'vitest';

import { LINK_MAX_LENGTH, normalizeLink } from './link.js';

describe('normalizeLink', () => {
  it('refuses a link the parser lengthens past the cap', () => {
    const typed = `https://example.com/${'é'.repeat(LINK_MAX_LENGTH - 40)}`;
    expect(typed.length).toBeLessThanOrEqual(LINK_MAX_LENGTH);
    expect(normalizeLink(typed)).toBeUndefined();
  });

  it('keeps a long link that stays within the cap', () => {
    const typed = `https://example.com/${'a'.repeat(LINK_MAX_LENGTH - 40)}`;
    expect(normalizeLink(typed)).toBe(typed);
  });

  it.each([
    'mailto:victim@example.com?bcc=attacker@example.com',
    'mailto:victim@example.com?cc=attacker@example.com',
    'mailto:victim@example.com?to=attacker@example.com',
    'mailto:victim@example.com?BCC=attacker@example.com',
    'mailto:?bcc=attacker@example.com',
    'mailto:?subject=Hi',
    'mailto:',
    'mailto:victim@example.com?subject=Hi%0D%0ABcc:%20attacker@example.com',
    'mailto:victim@example.com?body=one%0Atwo',
    'mailto:victim@example.com?x-header=1',
    'mailto:%20?subject=x',
    'mailto:%09',
    'mailto:%0D%0A?subject=x',
    'mailto:victim@example.com,%20',
    'mailto:victim@example.com%0D%0ABcc:attacker@example.com',
    'mailto:not-an-address',
    'mailto:%E0%A4%A',
  ])('refuses a mail link that hides recipients or headers: %s', (text) => {
    expect(normalizeLink(text)).toBeUndefined();
  });

  it('keeps a mail link to two recipients', () => {
    expect(normalizeLink('mailto:a@example.com,b@example.org')).toBe(
      'mailto:a@example.com,b@example.org',
    );
  });

  it('keeps a mail link with a subject and a body', () => {
    const link = 'mailto:team@example.com?subject=Retro&body=See%20the%20board';
    expect(normalizeLink(link)).toBe(link);
  });
});
