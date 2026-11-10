import {
  replaceFontFamilyCommand,
  runCommand,
  whenStoreIdle,
  type SkippedFontUse,
} from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { isTextBoxObject } from './text-box-object.js';
import { layoutContent, measuredSize } from './text-content-writer.js';
import type { TextModeContext } from './text-mode-context.js';

/**
 * What the person is told when a board-wide font replacement leaves objects or text styles as
 * they were: locked objects, and text styles a left object names.
 *
 * @param skipped - What the replacement left, at least one entry.
 * @returns The sentence.
 */
export function replacementLeftNotice(skipped: readonly SkippedFontUse[]): string {
  const count = skipped.length;
  return count === 1
    ? '1 locked object or style was left in its font.'
    : `${String(count)} locked objects or styles were left in their font.`;
}

/**
 * Replaces a font family everywhere the board names it, in one `replaceFontFamily`
 * command, so one undo step: every text box naming it is laid out in the new family first and
 * its measured size written with the replacement (a label has none of its own); a text that
 * cannot be laid out (no font yet) is replaced without a size and reported
 * (`onWrittenUnmeasured`). What the command leaves (locked objects, text styles they name) is
 * reported to the person (`onNotice`). While a stepped run holds the store, the replacement
 * waits, and measures the board as it is once idle.
 *
 * @param context - The mode's context: the document, origin, environment, layout, capture and
 *   where notices, refusals and unmeasured texts go.
 * @param from - The family to replace.
 * @param to - The new family.
 */
export function replaceFontFamilyOnBoard(
  context: Pick<
    TextModeContext,
    | 'store'
    | 'origin'
    | 'environment'
    | 'layout'
    | 'capture'
    | 'onNotice'
    | 'onCommandRefused'
    | 'onWrittenUnmeasured'
  >,
  from: string,
  to: string,
): void {
  whenStoreIdle(context.store, () => {
    replaceNow(context, from, to);
  });
}

/** What `replaceFontFamilyOnBoard` needs of the mode's context. */
type ReplaceContext = Parameters<typeof replaceFontFamilyOnBoard>[0];

/**
 * Replaces the family now (`replaceFontFamilyOnBoard`).
 *
 * @param context - The mode's context.
 * @param from - The family to replace.
 * @param to - The new family.
 */
function replaceNow(context: ReplaceContext, from: string, to: string): void {
  const measured: { id: ObjectId; width: number; height: number }[] = [];
  const unmeasured: ObjectId[] = [];
  for (const object of context.store.read().objects.values()) {
    if (!isTextBoxObject(object) || object.locked) continue;
    if (!object.runs.some((run) => run.style.fontFamily === from)) continue;
    const runs = object.runs.map((run) =>
      run.style.fontFamily === from ? { ...run, style: { ...run.style, fontFamily: to } } : run,
    );
    const layout = layoutContent(context, object, {
      text: object.text,
      runs,
      paragraphs: object.paragraphs,
    });
    if (layout === undefined) unmeasured.push(object.id);
    else measured.push({ id: object.id, ...measuredSize(object, layout) });
  }
  context.capture.command(() => {
    const { store, origin, environment } = context;
    const input = { from, to, ...(measured.length === 0 ? {} : { measured }) };
    const outcome = runCommand(store, origin, replaceFontFamilyCommand, input, environment);
    if (outcome.status !== 'applied') {
      context.onCommandRefused?.(outcome.errors);
      return;
    }
    for (const id of unmeasured) context.onWrittenUnmeasured?.(id);
    if (outcome.result.skipped.length > 0) {
      context.onNotice?.(replacementLeftNotice(outcome.result.skipped));
    }
  });
}
