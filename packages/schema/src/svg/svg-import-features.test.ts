import { describe, expect, it } from 'vitest';

import { features, imported, refusal, svg } from './__fixtures__/svg-import-helpers.js';
import { SVG_IMPORT_LIMITS } from './svg-limits.js';

describe('importSvg: references', () => {
  it('draws <use> of an element and of a symbol, moved and fitted', () => {
    const value = imported(
      svg(
        '<defs><rect id="r" width="10" height="10" fill="red"/>' +
          '<symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10" fill="blue"/></symbol></defs>' +
          '<use href="#r" x="20" y="30"/>' +
          '<use xlink:href="#s" x="50" y="50" width="40" height="40"/>' +
          '<use href="#s" x="0" y="80"/>',
      ),
    );
    expect(value.objects).toMatchObject([
      { type: 'shape', x: 20, y: 30, width: 10, fill: [1, 0, 0, 1] },
      { type: 'shape', x: 50, y: 50, width: 40, fill: [0, 0, 1, 1] },
      { type: 'shape', x: 0, y: 80, width: 10 },
    ]);
  });

  it('never fetches external references, and cuts missing references and cycles', () => {
    const value = imported(
      svg(
        '<use href="icons.svg#a"/><use href="#missing"/>' +
          '<g id="loop"><use href="#loop"/><rect width="1" height="1" fill="red"/></g>',
      ),
    );
    expect(features(value)).toEqual(['external reference', 'use', 'use']);
    expect(value.objects).toHaveLength(2);
    expect(imported(svg('<use/>')).objects).toEqual([]);
    const unreadable = imported(
      svg(
        '<defs><rect id="r" width="1" height="1" fill="red"/></defs><use href="#r" x="1em"/><svg y="1em"><use href="#r"/></svg>',
      ),
    );
    expect(unreadable.objects).toMatchObject([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(features(unreadable)).toEqual(['length', 'length']);
  });

  it('draws nested <svg> viewports', () => {
    const value = imported(
      svg(
        '<svg x="10" y="10" width="20" height="20" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>' +
          '<svg x="50"><rect width="10" height="10" fill="red"/></svg>',
      ),
    );
    expect(value.objects).toMatchObject([
      { x: 10, y: 10, width: 20 },
      { x: 50, y: 0, width: 10 },
    ]);
  });
});

describe('importSvg: what the board cannot draw', () => {
  it('reports each unsupported feature, still drawing the rest', () => {
    const value = imported(
      svg(
        '<style>.a { fill: red }</style><script>alert(1)</script>' +
          '<text x="0" y="10">Hi</text><image href="a.png"/><foreignObject/>' +
          '<rect width="10" height="10" fill="red" filter="url(#f)" mask="url(#m)"><animate attributeName="x"/></rect>' +
          '<g clip-path="url(#c)"><rect width="200" height="10" fill="red"/></g>' +
          '<path d="M0 0 L10 10" stroke="red" stroke-linecap="round" marker-end="url(#arrow)"/>' +
          '<switch><rect width="1" height="1" fill="red"/></switch>' +
          '<blink/><path d="M0 0 L10 10 L" stroke="red" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<g transform="spin(1)"><rect width="1" height="1" fill="red"/></g>' +
          '<defs><clipPath id="c"><rect width="100" height="100"/></clipPath></defs>',
      ),
    );
    expect(features(value)).toEqual([
      'style',
      'script',
      'text',
      'image',
      'foreignObject',
      'animate',
      'filter',
      'mask',
      'clip-path',
      'marker',
      'switch',
      '<blink>',
      'path data',
      'transform',
    ]);
    expect(value.objects).toHaveLength(6);
    expect(value.issues.every((issue) => issue.count === 1)).toBe(true);
  });

  it('counts repeats of one issue', () => {
    const value = imported(svg('<text/><text/><text/>'));
    expect(value.issues).toEqual([{ feature: 'text', detail: 'text is not imported', count: 3 }]);
  });

  it('reports a clip that clips something, or is not a plain rectangle', () => {
    const clipped = (clip: string, transform = ''): string[] =>
      features(
        imported(
          svg(
            `<defs><clipPath id="c">${clip}</clipPath></defs><g clip-path="url(#c)" ${transform}><rect width="10" height="10" fill="red"/></g>`,
          ),
        ),
      );
    expect(clipped('<rect width="20" height="20"/>')).toEqual([]);
    expect(clipped('<rect width="20" height="20"/>', 'transform="rotate(10)"')).toEqual([
      'clip-path',
    ]);
    expect(clipped('<rect width="20" height="20" rx="2"/>')).toEqual(['clip-path']);
    expect(clipped('<circle r="20"/>')).toEqual(['clip-path']);
    expect(clipped('<rect width="5" height="20"/>')).toEqual(['clip-path']);
    // A clip by unreadable length is not known to contain anything, and nor is a non-url clip.
    expect(clipped('<rect width="1em" height="20"/>')).toEqual(['clip-path']);
    expect(
      features(
        imported(svg('<g clip-path="inset(1px)"><rect width="1" height="1" fill="red"/></g>')),
      ),
    ).toEqual(['clip-path']);
    // A stroked path counts its stroke; a rotated shape its turned box.
    const stroked = svg(
      '<defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs><path clip-path="url(#c)" d="M0 5 H10" stroke="red" stroke-width="2" stroke-linecap="round"/>',
    );
    expect(features(imported(stroked))).toEqual(['clip-path']);
    const turned = svg(
      '<defs><clipPath id="c"><rect width="20" height="20"/></clipPath></defs><g clip-path="url(#c)"><rect x="5" width="10" height="10" transform="rotate(45 10 5)" fill="red"/></g>',
    );
    expect(features(imported(turned))).toEqual(['clip-path']);
  });

  it('applies display and visibility, and reports group and element opacity', () => {
    const value = imported(
      svg(
        '<g display="none"><rect width="1" height="1" fill="red"/></g>' +
          '<g visibility="hidden"><rect width="1" height="1" fill="red"/><rect width="1" height="1" fill="red" visibility="visible"/></g>' +
          '<g opacity="0.5"><rect width="1" height="1" fill="red"/><rect width="1" height="1" fill="red"/></g>' +
          '<rect width="1" height="1" fill="red" stroke="blue" stroke-linejoin="round" opacity="0.5"/>',
      ),
    );
    expect(value.objects).toHaveLength(4);
    expect(features(value)).toEqual(['opacity', 'opacity']);
    const root = imported(
      svg(
        '<rect width="1" height="1" fill="red"/><rect width="1" height="1" fill="red"/>',
        'opacity="0.5" filter="url(#f)"',
      ),
    );
    expect(features(root)).toEqual(['filter', 'opacity']);
    expect(
      imported(svg('<rect width="1" height="1" fill="red"/>', 'display="none"')).objects,
    ).toEqual([]);
  });
});

describe('importSvg: refusals and caps', () => {
  it('refuses malformed markup and a root that is not <svg>', () => {
    expect(refusal('<svg><g></svg>')).toBe('the SVG is malformed: </svg> closes <g>');
    expect(refusal('<html/>')).toBe('the root element is <html>, not <svg>');
  });

  it('refuses markup over the length cap', () => {
    const long = svg(`<!--${'x'.repeat(SVG_IMPORT_LIMITS.maxMarkupLength)}-->`);
    expect(refusal(long)).toBe(
      `the SVG is longer than ${String(SVG_IMPORT_LIMITS.maxMarkupLength)} characters`,
    );
  });

  it('refuses a document that draws too many objects or vertices', () => {
    const many = svg(
      '<rect width="1" height="1" fill="red"/>'.repeat(SVG_IMPORT_LIMITS.maxObjects + 1),
    );
    expect(refusal(many)).toBe(
      `the SVG draws more than ${String(SVG_IMPORT_LIMITS.maxObjects)} objects`,
    );
    const zigzag = Array.from(
      { length: 51_000 },
      (unused, index) => `${String(index % 7)} ${String(index % 3)}`,
    );
    const heavy = svg(
      `<path id="p" d="M0 0L${zigzag.join(' ')}" stroke="red" fill="none"/><use href="#p"/>`,
    );
    expect(refusal(heavy)).toBe(
      `the SVG has more than ${String(SVG_IMPORT_LIMITS.maxVertices)} vertices`,
    );
  });

  it('refuses <use> chains that expand past the visited-element cap', () => {
    // Each level uses the previous one ten times: 10⁵ leaves from a few hundred characters.
    let defs = '<g id="l0"><path d="M0 0"/></g>';
    for (let level = 1; level <= 5; level += 1) {
      defs += `<g id="l${String(level)}">${`<use href="#l${String(level - 1)}"/>`.repeat(10)}</g>`;
    }
    expect(refusal(svg(`<defs>${defs}</defs><use href="#l5"/>`))).toBe(
      `the SVG expands to more than ${String(SVG_IMPORT_LIMITS.maxVisitedElements)} elements`,
    );
  });
});
