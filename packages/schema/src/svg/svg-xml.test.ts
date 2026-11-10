import { describe, expect, it } from 'vitest';

import { SVG_IMPORT_LIMITS } from './svg-limits.js';
import { readSvgXml, type SvgElement } from './svg-xml.js';

function rootOf(markup: string): SvgElement {
  const result = readSvgXml(markup);
  if (result.status === 'refused') throw new Error(result.error);
  return result.root;
}

function errorOf(markup: string): string {
  const result = readSvgXml(markup);
  if (result.status === 'read') throw new Error('expected a refusal');
  return result.error;
}

describe('readSvgXml', () => {
  it('reads elements, attributes and nesting in document order', () => {
    const root = rootOf(
      `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox='0 0 24 24'>` +
        `<g fill="red"><path d="M0 0L1 1"/><circle r = "2" /></g>text<rect/></svg>`,
    );
    expect(root.name).toBe('svg');
    expect(root.attributes.get('viewBox')).toBe('0 0 24 24');
    expect(root.children.map((child) => child.name)).toEqual(['g', 'rect']);
    expect(root.children[0]?.children.map((child) => child.name)).toEqual(['path', 'circle']);
    expect(root.children[0]?.children[1]?.attributes.get('r')).toBe('2');
  });

  it('strips element prefixes and keeps attribute prefixes', () => {
    const root = rootOf('<svg:svg><svg:use xlink:href="#a"/></svg:svg>');
    expect(root.name).toBe('svg');
    expect(root.children[0]?.name).toBe('use');
    expect(root.children[0]?.attributes.get('xlink:href')).toBe('#a');
  });

  it('decodes predefined entities and character references only', () => {
    const root = rootOf('<svg a="&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&#x1F600;"/>');
    expect(root.attributes.get('a')).toBe('<>&"\'AB\u{1F600}');
    expect(errorOf('<svg a="&custom;"/>')).toBe(
      'the entity &custom; is not one of the five XML defines; entities are never expanded',
    );
    expect(errorOf('<svg a="&#0;"/>')).toBe('the character reference &#0; is not a character');
    expect(errorOf(`<svg a="&${'x'.repeat(100)};"/>`)).toMatch(/^the entity &x{39}…/);
  });

  it('skips comments, CDATA, processing instructions and the DOCTYPE without expanding entities', () => {
    const root = rootOf(
      '<!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]>' +
        '<!-- <rect/> --><svg><![CDATA[<rect/>]]><?pi <rect/>?><g a="b"/></svg>',
    );
    expect(root.children).toHaveLength(1);
    // A declared entity is refused, never expanded.
    expect(errorOf('<!DOCTYPE svg [<!ENTITY lol "lol">]><svg a="&lol;"/>')).toBe(
      'the entity &lol; is not one of the five XML defines; entities are never expanded',
    );
    expect(rootOf('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg/>').name).toBe('svg');
    expect(rootOf('<svg/>\n  <!-- trailing comment -->\n').name).toBe('svg');
  });

  it('refuses malformed markup', () => {
    expect(errorOf('')).toBe('the markup has no element');
    expect(errorOf('<svg>')).toBe('<svg> is never closed');
    expect(errorOf('<svg></g>')).toBe('</g> closes <svg>');
    expect(errorOf('<svg/></svg>')).toBe('</svg> closes nothing');
    expect(errorOf('<svg></svg ></svg>')).toBe('</svg> closes nothing');
    expect(errorOf('<svg></svg x>')).toMatch(/^<\/svg> is not closed with ">"/);
    expect(errorOf('<svg/><g/>')).toBe('<g> follows the root element');
    expect(errorOf('<svg a>')).toBe('attribute a has no value');
    expect(errorOf('<svg a=b>')).toBe("attribute a's value is not quoted");
    expect(errorOf('<svg a="b>')).toBe("attribute a's value is never closed");
    expect(errorOf('<svg a="<b"/>')).toBe('attribute a\'s value contains "<"');
    expect(errorOf('<svg a="1" a="2"/>')).toBe('attribute a is given twice');
    expect(errorOf('<svg a="1"')).toBe('<svg> is never closed');
    expect(errorOf('<svg/ >')).toBe('<svg/ is not followed by ">"');
    expect(errorOf('< svg/>')).toMatch(/^a name was expected at offset 1/);
    expect(errorOf('<svg><!-- x')).toMatch(/^a comment at offset 5 is never closed/);
    expect(errorOf('<!DOCTYPE svg [ <svg/>')).toMatch(/^a DOCTYPE/);
  });

  it('refuses markup over the element and depth caps', () => {
    const many = `<svg>${'<g/>'.repeat(SVG_IMPORT_LIMITS.maxElements)}</svg>`;
    expect(errorOf(many)).toBe(
      `the markup has more than ${String(SVG_IMPORT_LIMITS.maxElements)} elements`,
    );
    const depth = SVG_IMPORT_LIMITS.maxDepth;
    const deep = `${'<g>'.repeat(depth + 1)}${'</g>'.repeat(depth + 1)}`;
    expect(errorOf(deep)).toBe(`elements nest deeper than ${String(depth)}`);
    expect(rootOf(`${'<g>'.repeat(depth)}${'</g>'.repeat(depth)}`).name).toBe('g');
  });
});
