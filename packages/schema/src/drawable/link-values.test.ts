// The relay door's judgement of an object's link: a hostile peer's unsafe link is
// refused at the door, as the schema refuses it, unless the board already holds it.
import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from './drawable-values.js';
import { linkValueReason } from './link-values.js';

describe('linkValueReason', () => {
  it('lets through no link and a safe, normalised one', () => {
    expect(linkValueReason(undefined)).toBeUndefined();
    expect(linkValueReason('https://example.com/')).toBeUndefined();
    expect(linkValueReason('mailto:team@example.com')).toBeUndefined();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://user:pass@example.com/',
    'mailto:victim@example.com?bcc=attacker@example.com',
    'mailto:%20?subject=x',
    'HTTPS://Example.com',
    ' https://example.com/',
    '',
    null,
    42,
    { href: 'https://example.com/' },
  ])('refuses %j', (value) => {
    expect(linkValueReason(value)).toEqual({ field: '', reason: 'out-of-range' });
  });
});

describe('the door on a style group with a link', () => {
  it('refuses an unsafe link by its field', () => {
    expect(drawableValuesReason('style', { link: 'javascript:alert(1)' })).toEqual({
      field: 'link',
      reason: 'out-of-range',
    });
  });

  it('lets through a safe link, and one the board already holds', () => {
    expect(drawableValuesReason('style', { link: 'https://example.com/' })).toBeUndefined();
    const held = { link: 'javascript:alert(1)' };
    expect(drawableValuesReason('style', held, () => ({ value: held }))).toBeUndefined();
  });
});
