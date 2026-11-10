// Acceptance (Claude, from the PR 147 merge-queue run 37940053070): the font list
// re-applies its value when Enter or Escape hands the keyboard back to the editor
// (`SelectControl`), relying on a choice the range already has writing nothing. With families
// loaded on demand, the first choice is written before the family lands, its size unmeasured;
// once it lands the re-applied choice must still write nothing. Measuring the size is the size
// follower's write, with the system origin, not a second step of the person's.
import { describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import type { TextModeContext } from './text-mode-context.js';
import { TextEditingSession } from './text-session.js';

/** The family chosen before its files have landed; it lays out a quarter wider than the default. */
const LAZY_FAMILY = 'Lora';

describe('re-applying a family the range already has', () => {
  it('writes nothing, though the family landed after the first choice left the size unmeasured', () => {
    const object = tenPointText('t', 'range');
    const fixture = createTextModeContext([object]);
    let hasLanded = false;
    const unmeasured: ObjectId[] = [];
    const context: TextModeContext = {
      ...fixture.context,
      layout: {
        layout: (input) => {
          const isPending =
            !hasLanded && input.runs.some(({ style }) => style.fontFamily === LAZY_FAMILY);
          if (isPending) return undefined;
          const runs = input.runs.map((run) =>
            run.style.fontFamily === LAZY_FAMILY
              ? { ...run, style: { ...run.style, fontSize: run.style.fontSize * 1.25 } }
              : run,
          );
          return fixture.context.layout.layout({ ...input, runs });
        },
      },
      onWrittenUnmeasured: (id) => unmeasured.push(id),
    };
    const session = new TextEditingSession(context, object, 'all');

    // The choice from the list, before the family's files land: written, its size unmeasured.
    session.setStyle({ fontFamily: LAZY_FAMILY });
    expect(fixture.store.get(object.id)).toMatchObject({
      runs: [{ length: 5, style: { fontFamily: LAZY_FAMILY } }],
      width: object.width,
    });
    expect(unmeasured).toEqual([object.id]);

    // The files land; before the size follower runs, Enter re-applies the same choice.
    hasLanded = true;
    const written: ChangeSet[] = [];
    const stop = fixture.store.subscribe((changes) => written.push(changes));
    session.setStyle({ fontFamily: LAZY_FAMILY });
    stop();
    expect(written).toEqual([]);
    expect(fixture.store.get(object.id)).toMatchObject({ width: object.width });
  });
});
