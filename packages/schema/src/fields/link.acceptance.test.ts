// Links are canonical absolute URLs from the approved protocol set.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import * as publicSchema from '@canvas/schema';

// The exports are intentionally absent until the implementation lands.
const link = publicSchema as unknown as Record<string, unknown>;
const normalizeLink = link.normalizeLink as (value: string) => string | undefined;
const linkSchema = link.linkSchema as z.ZodType;

describe('link URL rules', () => {
  it('publishes the length cap and exact allowed protocols', () => {
    expect(link.LINK_MAX_LENGTH).toBe(2048);
    expect(link.LINK_PROTOCOLS).toEqual(['http:', 'https:', 'mailto:']);
  });

  it.each([
    ['https://example.com', 'https://example.com/'],
    ['http://example.com:8080/path?q=one#part', 'http://example.com:8080/path?q=one#part'],
    ['mailto:person@example.com', 'mailto:person@example.com'],
    ['https://bücher.example/a', 'https://xn--bcher-kva.example/a'],
    ['HTTPS://Example.com', 'https://example.com/'],
    ['  https://example.com/path  ', 'https://example.com/path'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeLink(input)).toBe(expected);
  });

  it.each([
    '',
    '  \t ',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<h1>x</h1>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    'about:blank',
    'blob:https://example.com/id',
    '//example.com/path',
    '/relative/path',
    'example.com',
    'https://user:pass@example.com/',
    'https://user@example.com/',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' javascript:alert(1)',
  ])('refuses %j', (input) => {
    expect(normalizeLink(input)).toBeUndefined();
  });

  it('measures the trimmed input before URL parsing', () => {
    const within = `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`;
    expect(within).toHaveLength(2048);
    expect(normalizeLink(` ${within} `)).toBe(within);
    expect(normalizeLink(`${within}a`)).toBeUndefined();
  });

  it('accepts only canonical safe strings in the stored schema', () => {
    for (const value of [
      'https://example.com/',
      'http://example.com:8080/a?q=1#f',
      'mailto:a@example.com',
    ]) {
      expect(linkSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [
      'HTTPS://Example.com',
      ' https://example.com/',
      'https://example.com',
      'javascript:alert(1)',
      '',
      3,
    ]) {
      expect(linkSchema.safeParse(value).success).toBe(false);
    }
  });
});
