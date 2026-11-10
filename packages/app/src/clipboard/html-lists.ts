import type { ParagraphStyle } from '@canvas/schema';

/** One paragraph of copied text: its inner HTML and its list style. */
export interface HtmlParagraph {
  /** The paragraph's content as HTML, its newline left out. */
  readonly html: string;
  /** Its list style; `{}` for a plain paragraph. */
  readonly style: ParagraphStyle;
}

/**
 * Copied paragraphs as HTML for other apps: a plain paragraph as `<p>`, list
 * paragraphs as nested `<ul>` / `<ol>` with one `<li>` each, a deeper level nested inside the
 * item before it, as word processors write lists. Pure.
 *
 * @param paragraphs - The paragraphs, in order.
 * @returns The HTML.
 */
export function paragraphsHtml(paragraphs: readonly HtmlParagraph[]): string {
  let html = '';
  const open: string[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) html += `</li></${open.pop() ?? 'ul'}>`;
  };
  for (const { html: body, style } of paragraphs) {
    if (style.list === undefined) {
      closeTo(0);
      html += `<p>${body}</p>`;
      continue;
    }
    const tag = style.list === 'numbered' ? 'ol' : 'ul';
    const depth = (style.level ?? 0) + 1;
    closeTo(depth);
    if (open.length === depth && open[depth - 1] !== tag) closeTo(depth - 1);
    if (open.length === depth) html += `</li><li>${body}`;
    else {
      while (open.length < depth) {
        open.push(tag);
        html += `<${tag}><li>`;
      }
      html += body;
    }
  }
  closeTo(0);
  return html;
}

/** The deepest list nesting a paste keeps; deeper items stay at the last level. */
const MAX_PASTED_LEVEL = 3;

/**
 * The list style an `<li>` gives its paragraph: bullet inside `<ul>`, numbered inside
 * `<ol>`, at its nesting depth (clamped to level 3); a level of 0 is written with no key.
 *
 * @param kind - The innermost list's kind.
 * @param depth - How many lists the item is inside, at least 1.
 * @returns The paragraph style.
 */
export function listItemStyle(kind: 'bullet' | 'numbered', depth: number): ParagraphStyle {
  const level = Math.min(MAX_PASTED_LEVEL, depth - 1);
  return level === 0 ? { list: kind } : { list: kind, level };
}
