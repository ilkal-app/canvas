// A run's language for choosing Han's face: its own tag, else Japanese when its
// paragraph holds kana, which Chinese text never does, so Japanese writers need not tag their
// text.

import { codepointAt } from '../layout/codepoints.js';

import { scriptOf } from './script-table.js';

/**
 * Whether a UTF-16 unit ends a paragraph: a line break, or another paragraph separator (UAX #9's
 * B class).
 *
 * @param unit - The unit.
 * @returns True when it does.
 */
export function isParagraphEnd(unit: number): boolean {
  return (
    unit === 0x0a ||
    unit === 0x0d ||
    unit === 0x1c ||
    unit === 0x1d ||
    unit === 0x1e ||
    unit === 0x85 ||
    unit === 0x2029
  );
}

/**
 * Tells, per paragraph of a text, whether it holds Hiragana or Katakana; built once per text.
 */
export class KanaParagraphs {
  /** Each UTF-16 index's paragraph has kana: built on first ask. */
  private hasKana: Uint8Array | undefined;

  /**
   * Reads a text's paragraphs, when first asked.
   *
   * @param text - The text.
   */
  constructor(private readonly text: string) {}

  /**
   * Whether the paragraph holding an index has kana.
   *
   * @param index - A UTF-16 index of the text.
   * @returns True when it does.
   */
  at(index: number): boolean {
    this.hasKana ??= this.scan();
    return this.hasKana[index] === 1;
  }

  /**
   * Marks each paragraph that has kana.
   *
   * @returns One flag per UTF-16 index.
   */
  private scan(): Uint8Array {
    const { text } = this;
    const flags = new Uint8Array(text.length);
    let start = 0;
    let hasKana = false;
    for (let index = 0; index <= text.length;) {
      if (index === text.length || isParagraphEnd(text.charCodeAt(index))) {
        if (hasKana) flags.fill(1, start, index);
        start = index + 1;
        hasKana = false;
        index += 1;
        continue;
      }
      const { codepoint, length } = codepointAt(text, index);
      const script = scriptOf(codepoint);
      if (script === 'Hira' || script === 'Kana') hasKana = true;
      index += length;
    }
    return flags;
  }
}

/**
 * The language a run's text takes for choosing a face: its own tag, else `ja` where its paragraph
 * holds kana, else none.
 *
 * @param lang - The run's tag, if it has one.
 * @param kana - The text's kana paragraphs, or any lookup of whether an index's paragraph has kana.
 * @param index - A UTF-16 index inside the run.
 * @returns The language, or `undefined`.
 */
export function effectiveLanguage(
  lang: string | undefined,
  kana: Pick<KanaParagraphs, 'at'>,
  index: number,
): string | undefined {
  if (lang !== undefined) return lang;
  return kana.at(index) ? 'ja' : undefined;
}
