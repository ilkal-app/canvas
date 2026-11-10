import { describe, expect, it } from 'vitest';

import { importSvg } from '@canvas/schema';

import { svgDocument } from './svg-document.js';

describe('svgDocument', () => {
  it('wraps the body in a standalone SVG 1.1 document with namespaces and a default viewBox', () => {
    const body = '<g><path d="M 0 0 L 1 1"/></g>';
    const svg = svgDocument({ width: 320, height: 180, body });
    expect(svg).toMatch(/<svg\b/);
    expect(svg).toMatch(/<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toMatch(/<svg\b[^>]*xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/);
    expect(svg).toMatch(/<svg\b[^>]*width="320"[^>]*height="180"/);
    expect(svg).toMatch(/<svg\b[^>]*viewBox="0 0 320 180"/);
    expect(svg).toContain(body);
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
    expect(importSvg(svg).status).toBe('imported');
  });

  it('uses an explicit viewBox without changing document dimensions or body', () => {
    const svg = svgDocument({ width: 200, height: 100, viewBox: [-10, 5, 40, 20], body: '<g/>' });
    expect(svg).toMatch(/width="200"[^>]*height="100"/);
    expect(svg).toContain('viewBox="-10 5 40 20"');
    expect(svg).toContain('<g/>');
    expect(importSvg(svg).status).toBe('imported');
  });
});
