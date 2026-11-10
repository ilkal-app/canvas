// Written before the code. CONTRACT: run links use canonical link rules and split unequal runs. Deliberately not asserted: drawing or editor UI.
import { describe, expect, it } from 'vitest';

import { LINK_MAX_LENGTH } from './link.js';
import { findRunIssues } from './text-content.js';
import { isSameTextStyle, textStyleSchema } from './text-style.js';

const BASE = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
} as const;
const FIRST = 'https://example.com/first';
const SECOND = 'mailto:person@example.com';

describe('run link schema', () => {
  it.each([FIRST, SECOND, 'http://example.com:8080/path?q=one#part'])(
    'accepts canonical link %s on a run',
    (link) => {
      expect(textStyleSchema.parse({ ...BASE, link })).toHaveProperty('link', link);
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'https://user:pass@example.com/',
    'https://user@example.com/',
    '/relative',
    'example.com',
    ' https://example.com/ ',
    'HTTPS://Example.com',
    'https://example.com',
    `https://example.com/${'a'.repeat(LINK_MAX_LENGTH)}`,
    7,
  ])('refuses noncanonical or unsafe run link %j', (link) => {
    expect(textStyleSchema.safeParse({ ...BASE, link }).success).toBe(false);
  });

  it('keeps adjacent runs with different links and reports equal neighbours', () => {
    const first = textStyleSchema.parse({ ...BASE, link: FIRST });
    const second = textStyleSchema.parse({ ...BASE, link: SECOND });
    expect(isSameTextStyle(first, second)).toBe(false);
    expect(isSameTextStyle(first, { ...first })).toBe(true);
    expect(
      findRunIssues('abcd', [
        { length: 2, style: first },
        { length: 2, style: second },
      ]),
    ).toEqual([]);
    expect(
      findRunIssues('abcd', [
        { length: 2, style: first },
        { length: 2, style: { ...first } },
      ]),
    ).not.toEqual([]);
  });
});
