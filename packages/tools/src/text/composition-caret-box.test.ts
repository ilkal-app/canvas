import { expect, it } from 'vitest';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { sessionCaretBox } from './text-session-geometry.js';
import { TextEditingSession } from './text-session.js';

it('opens the input method window at its caret or target segment, not the composition end', () => {
  const object = tenPointText('composition', 'abcd');
  const { context } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, 2);
  session.updateComposition('zhongwen');
  const atEnd = sessionCaretBox(session)?.x;
  session.updateComposition('zhongwen', [3, 3]);
  const atCaret = sessionCaretBox(session)?.x;
  session.updateComposition('zhongwen', [5, 8]);
  const atTarget = sessionCaretBox(session)?.x;
  expect(atEnd).toBeDefined();
  expect(atCaret).toBeLessThan(atEnd ?? 0);
  expect(atTarget).toBeGreaterThan(atCaret ?? 0);
  expect(atTarget).toBeLessThan(atEnd ?? 0);
});
