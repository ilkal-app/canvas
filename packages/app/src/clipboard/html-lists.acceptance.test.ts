// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { copySelection } from '@canvas/document';
import { paragraphCount, type ObjectId, type ParagraphStyle, type StyleRun } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import { encodeClipboardFlavours } from './clipboard-flavours.js';
import { HTML_MIME_TYPE } from './clipboard-formats.js';
import { textFromHtml } from './html-flavour.js';

type Parsed = NonNullable<ReturnType<typeof textFromHtml>> & {
  paragraphs?: readonly ParagraphStyle[];
};
const parsed = (html: string): Parsed | undefined => textFromHtml(html) as Parsed | undefined;

describe('HTML list and decoration paste', () => {
  it('reads inherited decorations and explicit none', () => {
    const content = parsed(
      '<u>a<ins>b</ins><span style="text-decoration: none">c</span></u><s>d</s><del>e</del><strike>f</strike><span style="text-decoration-line: underline line-through">g</span>',
    );
    expect(content?.text).toBe('abcdefg');
    expect(
      content?.runs.flatMap((run: StyleRun) =>
        Array.from({ length: run.length }, () => ({
          underline: run.style.underline,
          strikethrough: run.style.strikethrough,
        })),
      ),
    ).toEqual([
      { underline: true, strikethrough: undefined },
      { underline: true, strikethrough: undefined },
      { underline: undefined, strikethrough: undefined },
      { underline: undefined, strikethrough: true },
      { underline: undefined, strikethrough: true },
      { underline: undefined, strikethrough: true },
      { underline: true, strikethrough: true },
    ]);
  });

  it('converts nested list items into paragraphs and retains trailing plain text', () => {
    const content = parsed('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><p>d</p>');
    expect(content?.text).toBe('a\nb\nc\nd');
    expect(content?.paragraphs).toEqual([
      { list: 'bullet' },
      { list: 'bullet', level: 1 },
      { list: 'bullet' },
      {},
    ]);
    expect(content?.paragraphs).toHaveLength(paragraphCount(content?.text ?? ''));
    expect(parsed('<p>plain</p>')).not.toHaveProperty('paragraphs');
  });

  it('clamps deeply nested ordered lists to level three', () => {
    const content = parsed(
      '<ol><li>a<ol><li>b<ol><li>c<ol><li>d<ol><li>e</li></ol></li></ol></li></ol></li></ol></li></ol>',
    );
    expect(content?.paragraphs).toEqual([
      { list: 'numbered' },
      { list: 'numbered', level: 1 },
      { list: 'numbered', level: 2 },
      { list: 'numbered', level: 3 },
      { list: 'numbered', level: 3 },
    ]);
  });

  it('round trips copied list paragraphs and decorated runs through HTML', () => {
    const board = clipboardBoard();
    const title = board.objects.get('title' as ObjectId);
    if (title?.type !== 'text') throw new Error('Missing text fixture');
    const firstRun = title.runs[0];
    if (firstRun === undefined) throw new Error('Missing text run');
    const source: typeof title = {
      ...title,
      text: 'one\ntwo',
      runs: [
        { length: 4, style: { ...firstRun.style, underline: true } },
        { length: 3, style: { ...firstRun.style, strikethrough: true } },
      ],
      paragraphs: [{ list: 'bullet' }, { list: 'numbered', level: 1 }],
    };
    const copied = copySelection(
      {
        ...board,
        objects: new Map(board.objects).set(title.id, source),
      },
      [title.id],
    );
    const html = encodeClipboardFlavours(copied ?? board).get(HTML_MIME_TYPE) ?? '';
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('text-decoration');
    const content = parsed(html);
    expect(content?.text).toBe(source.text);
    expect(content?.paragraphs).toEqual(source.paragraphs);
    expect(
      content?.runs.map((run: StyleRun) => ({
        length: run.length,
        underline: run.style.underline,
        strikethrough: run.style.strikethrough,
      })),
    ).toEqual([
      { length: 4, underline: true, strikethrough: undefined },
      { length: 3, underline: undefined, strikethrough: true },
    ]);
  });
});
