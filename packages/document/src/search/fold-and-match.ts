/** Combining marks, but not the kana voicing marks (U+3099, U+309A), which change the word. */
const STRIPPED_MARKS = /(?![゙゚])\p{M}/gu;

/** A word: a run of letters and digits (marks stay inside it, Arabic and Hebrew included). */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/** Scripts written without spaces between words, which match anywhere in the text. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Text as board search compares it: compatibility forms folded (full-width letters),
 * accents and other combining marks dropped (Arabic harakat and Hebrew niqqud too; not the kana
 * voicing marks), Hangul recomposed, then lower-cased without regard to locale. Pure.
 *
 * @param text - The text.
 * @returns Its folded form.
 */
export function foldForSearch(text: string): string {
  return text.normalize('NFKD').replace(STRIPPED_MARKS, '').normalize('NFC').toLowerCase();
}

/**
 * The words of folded text: its runs of letters and digits, so punctuation and spaces split them
 * ("bug-triage" is "bug" and "triage"). Pure.
 *
 * @param folded - Text already folded (`foldForSearch`).
 * @returns Its words, in order.
 */
export function searchWordsOf(folded: string): readonly string[] {
  return folded.match(WORD) ?? [];
}

/**
 * Whether folded text, with its words, matches folded query words: every query word must start
 * one of the text's words, or, for a word in a script written without spaces (CJK), occur
 * anywhere in it. No query words match nothing. Pure.
 *
 * @param folded - The text, folded.
 * @param words - Its words (`searchWordsOf`).
 * @param queryWords - The query's words, folded.
 * @returns Whether it matches.
 */
export function matchesFoldedQuery(
  folded: string,
  words: readonly string[],
  queryWords: readonly string[],
): boolean {
  if (queryWords.length === 0) return false;
  return queryWords.every((queryWord) =>
    UNSPACED_SCRIPT.test(queryWord)
      ? folded.includes(queryWord)
      : words.some((word) => word.startsWith(queryWord)),
  );
}

/**
 * Whether text matches a board search query: both folded (`foldForSearch`: case and
 * accents ignored), every query word the start of one of the text's words, or anywhere in it for
 * Chinese, Japanese and Korean; an empty query matches nothing. Pure.
 *
 * @param text - The text.
 * @param query - The query.
 * @returns Whether it matches.
 */
export function matchesQuery(text: string, query: string): boolean {
  const folded = foldForSearch(text);
  return matchesFoldedQuery(folded, searchWordsOf(folded), searchWordsOf(foldForSearch(query)));
}
