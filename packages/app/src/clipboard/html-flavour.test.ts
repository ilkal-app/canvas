// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { copySelection } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import { encodeClipboardFlavours } from './clipboard-flavours.js';
import { CANVAS_OBJECTS_MIME_TYPE, HTML_MIME_TYPE } from './clipboard-formats.js';
import { MAX_PASTE_MARKUP_LENGTH } from './clipboard-notice.js';
import { embeddedObjectsOf, textFromHtml } from './html-flavour.js';
import { PASTED_TEXT_STYLE } from './pasted-text.js';

const BOLD = { ...PASTED_TEXT_STYLE, weight: 700 };
const ITALIC = { ...PASTED_TEXT_STYLE, italic: true };

describe('embeddedObjectsOf', () => {
  it('finds the objects a copy from the canvas embedded in its HTML', () => {
    const copied = copySelection(clipboardBoard(), ['title'] as ObjectId[]);
    const flavours = encodeClipboardFlavours(copied ?? clipboardBoard());
    expect(embeddedObjectsOf(flavours.get(HTML_MIME_TYPE) ?? '')).toBe(
      flavours.get(CANVAS_OBJECTS_MIME_TYPE),
    );
  });

  it('finds nothing in other HTML', () => {
    expect(embeddedObjectsOf('<p>Hello</p>')).toBeUndefined();
  });
});

describe('textFromHtml', () => {
  it('reads letter-spacing and line-height, inherited and reset by normal', () => {
    const content = textFromHtml(
      '<p style="line-height: 1.5"><span style="letter-spacing: 0.1em">AB</span>C<span style="line-height: normal">D</span></p>',
    );
    expect(content?.text).toBe('ABCD');
    const lineHeight = { value: 150, unit: 'percent' } as const;
    expect(content?.runs).toEqual([
      {
        length: 2,
        style: { ...PASTED_TEXT_STYLE, letterSpacing: { value: 10, unit: 'percent' }, lineHeight },
      },
      { length: 1, style: { ...PASTED_TEXT_STYLE, lineHeight } },
      { length: 1, style: PASTED_TEXT_STYLE },
    ]);
  });

  it('keeps bold, italic and colour as runs on the canvas style', () => {
    const content = textFromHtml(
      '<p>Plain <b>bold</b> <em>italic</em> <span style="color: rgb(255, 0, 0)">red</span></p>',
    );
    expect(content?.text).toBe('Plain bold italic red');
    expect(content?.runs).toEqual([
      { length: 6, style: PASTED_TEXT_STYLE },
      { length: 4, style: BOLD },
      { length: 1, style: PASTED_TEXT_STYLE },
      { length: 6, style: ITALIC },
      { length: 1, style: PASTED_TEXT_STYLE },
      { length: 3, style: { ...PASTED_TEXT_STYLE, color: [1, 0, 0, 1] } },
    ]);
  });

  it('reads font-weight and font-style declarations and hex colours', () => {
    const content = textFromHtml(
      '<span style="font-weight: 700">A</span><span style="font-style: italic; color: #00f">B</span><b style="font-weight: normal">C</b>',
    );
    expect(content?.runs).toEqual([
      { length: 1, style: BOLD },
      { length: 1, style: { ...ITALIC, color: [0, 0, 1, 1] } },
      { length: 1, style: PASTED_TEXT_STYLE },
    ]);
  });

  it('starts a line for each block and <br>, trims the ends and collapses spaces', () => {
    const content = textFromHtml(
      '<meta charset="utf-8">\n<h1>Title</h1>\n  <p>one<br>two</p><div>  three   four </div>',
    );
    expect(content?.text).toBe('Title\none\ntwo\nthree four');
  });

  it('ignores scripts and styles, and finds no text in empty HTML', () => {
    expect(textFromHtml('<style>p { color: red }</style><script>1</script><p>ok</p>')?.text).toBe(
      'ok',
    );
    expect(textFromHtml('<p>  </p>')).toBeUndefined();
    expect(textFromHtml('')).toBeUndefined();
  });

  it('keeps the inherited colour for colours it cannot read, and skips comments', () => {
    const content = textFromHtml(
      '<span style="color: rgb(255, 0, 0)">a<span style="color: blue">b</span></span><!-- note -->c',
    );
    expect(content?.runs).toEqual([
      { length: 2, style: { ...PASTED_TEXT_STYLE, color: [1, 0, 0, 1] } },
      { length: 1, style: PASTED_TEXT_STYLE },
    ]);
  });

  it('reads no HTML over the paste limit', () => {
    const huge = `<p data-canvas-objects="{}">${'x'.repeat(MAX_PASTE_MARKUP_LENGTH)}</p>`;
    expect(textFromHtml(huge)).toBeUndefined();
    expect(embeddedObjectsOf(huge)).toBeUndefined();
  });

  it('keeps an emoji whole in one run', () => {
    const content = textFromHtml('<b>hi</b>👋');
    expect(content?.runs).toEqual([
      { length: 2, style: BOLD },
      { length: 2, style: PASTED_TEXT_STYLE },
    ]);
  });
});
