import { describe, expect, it } from 'vitest';

import { importSvg } from './svg-import.js';
import { SVG_IMPORT_LIMITS } from './svg-limits.js';

// Hostile markup inside every size cap (review): each must end in a structured result, a
// refusal or an import, quickly, never in a thrown stack overflow or seconds of work.

/**
 * Imports markup, keeping what a test checks.
 *
 * @param markup - The SVG.
 * @returns The result's status, its error or object count, and the features it reported.
 */
function timed(markup: string): { status: string; detail: string | number; features: string[] } {
  const result = importSvg(markup);
  return result.status === 'refused'
    ? { status: result.status, detail: result.error, features: [] }
    : {
        status: result.status,
        detail: result.value.objects.length,
        features: result.value.issues.map((issue) => `${issue.feature}: ${issue.detail}`),
      };
}

describe('importSvg against hostile markup within the caps', () => {
  it('refuses a <use> chain deeper than the cap instead of overflowing the stack', () => {
    const chain = (length: number): string => {
      const links = Array.from(
        { length },
        (unused, index) => `<g id="u${String(index)}"><use href="#u${String(index + 1)}"/></g>`,
      ).join('');
      return `<svg><defs>${links}<rect id="u${String(length)}" width="10" height="10"/></defs><use href="#u0"/></svg>`;
    };
    const deep = timed(chain(1_000));
    expect(deep.status).toBe('refused');
    expect(deep.detail).toBe(
      `elements nest deeper than ${String(SVG_IMPORT_LIMITS.maxDrawDepth)}, <use> references included`,
    );
    expect(timed(chain(20))).toMatchObject({ status: 'imported', detail: 1 });
  });

  it('reads a paint fallback once, never as another reference', () => {
    const paint = `${'url(#missing) '.repeat(8_000)}red`;
    const result = timed(`<svg><path d="M0 0 L10 0 L10 10 Z" fill="${paint}"/></svg>`);
    // One unreadable fallback, reported once: the 7,999 references after it are not followed.
    expect(result).toMatchObject({ status: 'imported', detail: 0 });
    expect(result.features).toEqual([
      'paint: "url(#missing) url(#missing) url(#missing…" is not a colour the board reads; not drawn',
    ]);
    const fallback = importSvg(
      '<svg><path d="M0 0 L10 0 L10 10 Z" fill="url(#missing) url(#other)"/></svg>',
    );
    expect(
      fallback.status === 'imported' && fallback.value.issues.map((issue) => issue.feature),
    ).toEqual(['paint']);
  });

  it('follows at most a bounded chain of gradient hrefs', () => {
    const count = 4_000;
    const gradients =
      Array.from(
        { length: count },
        (unused, index) => `<linearGradient id="g${String(index)}" href="#g${String(index + 1)}"/>`,
      ).join('') +
      `<linearGradient id="g${String(count)}"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>`;
    const result = timed(
      `<svg><defs>${gradients}</defs><rect width="10" height="10" fill="url(#g0)"/></svg>`,
    );
    expect(result.status).toBe('imported');
    expect(result.features).toEqual(['gradient: an href chain is followed for 32 gradients']);
  });

  it('bounds the fill-rule check over the whole import, not per object', () => {
    const points = Array.from({ length: 1_000 }, (unused, index) => {
      const angle = (2 * Math.PI * index) / 1_000;
      return `${(100 + 90 * Math.cos(angle)).toFixed(2)},${(100 + 90 * Math.sin(angle)).toFixed(2)}`;
    }).join(' ');
    const markup = `<svg><defs><polygon id="p" points="${points}"/></defs>${'<use href="#p"/>'.repeat(90)}</svg>`;
    // The first copy spends the budget; the other 89 are reported as not checked, not scanned.
    const value = importSvg(markup);
    expect(value.status === 'imported' && value.value.objects.length).toBe(90);
    expect(value.status === 'imported' && value.value.issues).toEqual([
      {
        feature: 'fill-rule',
        detail: 'too complex to check; nonzero is drawn even-odd',
        count: 89,
      },
    ]);
  });

  it('refuses malformed XML around and inside the root', () => {
    for (const [markup, error] of [
      [
        '<svg><rect width="10" height="10"/></svg>oops',
        'text "oops" lies outside the root element',
      ],
      ['oops<svg/>', 'text "oops" lies outside the root element'],
      [
        '<svg><rect width="10" height="10" fill="red & blue"/></svg>',
        'a "&" at offset 44 starts no entity reference',
      ],
      ['<svg>a & b</svg>', 'a "&" at offset 7 starts no entity reference'],
      [
        '<svg a="&custom;"/>',
        'the entity &custom; is not one of the five XML defines; entities are never expanded',
      ],
      ['<svg a="&#x110000;"/>', 'the character reference &#x110000; is not a character'],
      ['<svg/><!ENTITY x "bad">', 'a declaration at offset 6 lies outside the prolog'],
      ['<svg/><![CDATA[x]]>', 'a CDATA section at offset 6 lies outside the root element'],
      ['<!DOCTYPEfoo><svg/>', 'a declaration at offset 0 lies outside the prolog'],
      ['<!DOCTYPE svg><!DOCTYPE svg><svg/>', 'a second DOCTYPE at offset 14'],
      ['<!ELEMENT svg ANY><svg/>', 'a declaration at offset 0 lies outside the prolog'],
    ] as const) {
      expect(importSvg(markup), markup).toEqual({
        status: 'refused',
        error: `the SVG is malformed: ${error}`,
      });
    }
  });
});
