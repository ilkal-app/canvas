// A small XML reader for SVG import. The markup is untrusted, so it is read as data and
// nothing in it runs or loads: there is no DOM, no external entity, no DTD. A DOCTYPE is skipped
// with its internal subset unread, so an entity it declares is never expanded (no "billion
// laughs"): only the five predefined entities and character references are decoded, and any other
// reference refuses the markup, as does text outside the root. The element
// count and nesting depth are capped (`SVG_IMPORT_LIMITS`). Pure.
import { SVG_IMPORT_LIMITS } from './svg-limits.js';
import { excerpt } from './svg-values.js';

/** An element of the markup: its local name, attributes and child elements. */
export interface SvgElement {
  /** The element's local name, any namespace prefix removed (`svg:path` is `path`). */
  readonly name: string;
  /** The attributes as written, by qualified name (`xlink:href` keeps its prefix). */
  readonly attributes: ReadonlyMap<string, string>;
  /** The child elements, in document order; text and comments are not kept. */
  readonly children: readonly SvgElement[];
}

/** The markup read into a tree, or why it could not be. */
export type SvgXmlResult =
  | { readonly status: 'read'; readonly root: SvgElement }
  | { readonly status: 'refused'; readonly error: string };

/** An element being read: its children are still arriving. */
interface OpenElement {
  readonly name: string;
  readonly attributes: Map<string, string>;
  readonly children: SvgElement[];
}

const NAME = /[A-Za-z_:][\w.:-]*/y;
const SPACE = /\s*/y;
/** A DOCTYPE's start: the keyword, then white space before its name. */
const DOCTYPE = /^<!DOCTYPE\s/;
const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

const REFERENCE = /&(?:#x([0-9a-fA-F]+)|#(\d+)|([A-Za-z_][\w.-]*));/y;

/**
 * Tells whether a code point is an XML character (XML 1.0 §2.2).
 *
 * @param code - The code point.
 * @returns True when a character reference may name it.
 */
function isXmlCharacter(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * Decodes the references in text or an attribute value: the five predefined entities and
 * character references. Any other entity refuses the markup, since none is ever expanded (the DTD
 * is not read), and so does a `&` that starts no reference.
 *
 * @param text - The raw text.
 * @param offset - Where it starts in the markup, for messages.
 * @returns The decoded text.
 * @throws {Error} At the first malformed or unexpanded reference.
 */
function decodeReferences(text: string, offset: number): string {
  let decoded = '';
  let last = 0;
  for (let at = text.indexOf('&'); at >= 0; at = text.indexOf('&', last)) {
    REFERENCE.lastIndex = at;
    const match = REFERENCE.exec(text);
    if (match === null)
      throw new Error(`a "&" at offset ${String(offset + at)} starts no entity reference`);
    const [whole, hex, digits, name] = match;
    let replacement: string | undefined;
    if (name === undefined) {
      const code = hex === undefined ? Number(digits) : parseInt(hex, 16);
      if (!isXmlCharacter(code)) {
        throw new Error(`the character reference ${excerpt(whole)} is not a character`);
      }
      replacement = String.fromCodePoint(code);
    } else {
      replacement = PREDEFINED[name];
      if (replacement === undefined) {
        throw new Error(
          `the entity ${excerpt(whole)} is not one of the five XML defines; entities are never expanded`,
        );
      }
    }
    decoded += text.slice(last, at) + replacement;
    last = at + whole.length;
  }
  return decoded + text.slice(last);
}

/**
 * The local part of a qualified name.
 *
 * @param name - A name, perhaps prefixed.
 * @returns The name after its last colon.
 */
function localName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1);
}

/** Reads markup left to right, one construct at a time. */
class Reader {
  private position = 0;
  private elements = 0;
  private readonly stack: OpenElement[] = [];
  private root: SvgElement | undefined;
  private hasDoctype = false;

  constructor(private readonly markup: string) {}

  /**
   * Reads the whole markup.
   *
   * @returns The root element, or the first problem found.
   */
  read(): SvgXmlResult {
    try {
      while (this.position < this.markup.length) this.step();
      if (this.stack.length > 0) this.fail(`<${String(this.stack.at(-1)?.name)}> is never closed`);
      if (this.root === undefined) this.fail('the markup has no element');
      return { status: 'read', root: this.root };
    } catch (error) {
      return { status: 'refused', error: (error as Error).message };
    }
  }

  private fail(message: string): never {
    throw new Error(message);
  }

  private skipPast(terminator: string, what: string): void {
    const end = this.markup.indexOf(terminator, this.position);
    if (end < 0) this.fail(`${what} at offset ${String(this.position)} is never closed`);
    this.position = end + terminator.length;
  }

  private step(): void {
    const { markup } = this;
    const found = markup.indexOf('<', this.position);
    const start = found < 0 ? markup.length : found;
    this.checkText(markup.slice(this.position, start), this.position);
    this.position = start;
    if (found < 0) return;
    const isOutside = this.stack.length === 0;
    if (markup.startsWith('<!--', start)) this.skipPast('-->', 'a comment');
    else if (markup.startsWith('<![CDATA[', start)) {
      if (isOutside)
        this.fail(`a CDATA section at offset ${String(start)} lies outside the root element`);
      this.skipPast(']]>', 'a CDATA section');
    } else if (markup.startsWith('<?', start)) this.skipPast('?>', 'a processing instruction');
    else if (markup.startsWith('<!', start)) {
      const isProlog = isOutside && this.root === undefined;
      if (!isProlog || !DOCTYPE.test(markup.slice(start, start + 10))) {
        this.fail(`a declaration at offset ${String(start)} lies outside the prolog`);
      }
      if (this.hasDoctype) this.fail(`a second DOCTYPE at offset ${String(start)}`);
      this.hasDoctype = true;
      this.skipDeclaration();
    } else if (markup.startsWith('</', start)) this.closeElement();
    else this.openElement();
  }

  /**
   * Checks text between markup: its references must be well formed, and outside the root it may
   * only be white space. Its content is not kept.
   *
   * @param text - The text.
   * @param offset - Where it starts.
   */
  private checkText(text: string, offset: number): void {
    decodeReferences(text, offset);
    const content = text.trim();
    if (this.stack.length === 0 && content !== '') {
      this.fail(`text "${excerpt(content)}" lies outside the root element`);
    }
  }

  /** Skips a DOCTYPE, its internal subset unread: nothing it declares is used. */
  private skipDeclaration(): void {
    const subset = this.markup.indexOf('[', this.position);
    const close = this.markup.indexOf('>', this.position);
    if (subset >= 0 && (close < 0 || subset < close)) {
      this.position = subset;
      this.skipPast(']', 'a DOCTYPE');
    }
    this.skipPast('>', 'a declaration');
  }

  private readName(): string {
    NAME.lastIndex = this.position;
    const match = NAME.exec(this.markup);
    if (match === null) this.fail(`a name was expected at offset ${String(this.position)}`);
    this.position = NAME.lastIndex;
    return match[0];
  }

  private skipSpace(): void {
    SPACE.lastIndex = this.position;
    SPACE.exec(this.markup);
    this.position = SPACE.lastIndex;
  }

  private closeElement(): void {
    this.position += 2;
    const name = localName(this.readName());
    this.skipSpace();
    if (this.markup[this.position] !== '>') {
      this.fail(`</${name}> is not closed with ">" at offset ${String(this.position)}`);
    }
    this.position += 1;
    const open = this.stack.pop();
    if (open?.name !== name) {
      this.fail(`</${name}> closes ${open === undefined ? 'nothing' : `<${open.name}>`}`);
    }
    this.finish(open);
  }

  private openElement(): void {
    this.position += 1;
    const name = localName(this.readName());
    this.elements += 1;
    if (this.elements > SVG_IMPORT_LIMITS.maxElements) {
      this.fail(`the markup has more than ${String(SVG_IMPORT_LIMITS.maxElements)} elements`);
    }
    if (this.stack.length >= SVG_IMPORT_LIMITS.maxDepth) {
      this.fail(`elements nest deeper than ${String(SVG_IMPORT_LIMITS.maxDepth)}`);
    }
    if (this.root !== undefined && this.stack.length === 0) {
      this.fail(`<${name}> follows the root element`);
    }
    const element: OpenElement = { name, attributes: new Map(), children: [] };
    for (;;) {
      this.skipSpace();
      const next = this.markup[this.position];
      if (next === '>' || next === '/') break;
      if (next === undefined) this.fail(`<${name}> is never closed`);
      this.readAttribute(element);
    }
    if (this.markup[this.position] === '/') {
      this.position += 1;
      if (this.markup[this.position] !== '>') this.fail(`<${name}/ is not followed by ">"`);
      this.position += 1;
      this.finish(element);
    } else {
      this.position += 1;
      this.stack.push(element);
    }
  }

  private readAttribute(element: OpenElement): void {
    const name = this.readName();
    this.skipSpace();
    if (this.markup[this.position] !== '=') this.fail(`attribute ${name} has no value`);
    this.position += 1;
    this.skipSpace();
    const quote = this.markup[this.position];
    if (quote !== '"' && quote !== "'") this.fail(`attribute ${name}'s value is not quoted`);
    const end = this.markup.indexOf(quote, this.position + 1);
    if (end < 0) this.fail(`attribute ${name}'s value is never closed`);
    const raw = this.markup.slice(this.position + 1, end);
    if (raw.includes('<')) this.fail(`attribute ${name}'s value contains "<"`);
    if (element.attributes.has(name)) this.fail(`attribute ${name} is given twice`);
    element.attributes.set(name, decodeReferences(raw, this.position + 1));
    this.position = end + 1;
  }

  private finish(element: OpenElement): void {
    const done: SvgElement = element;
    const parent = this.stack.at(-1);
    if (parent === undefined) this.root = done;
    else parent.children.push(done);
  }
}

/**
 * Reads SVG markup into an element tree, without running or loading anything: text, comments,
 * CDATA, processing instructions and the DOCTYPE are skipped, and only predefined entities and
 * character references are decoded. Refuses malformed markup (an unclosed or mismatched tag, an
 * unquoted or repeated attribute, a second root) and markup over the element or depth caps.
 *
 * @param markup - The markup; not mutated.
 * @returns The root element, or the first problem.
 */
export function readSvgXml(markup: string): SvgXmlResult {
  return new Reader(markup).read();
}
