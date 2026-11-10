import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { TextEditingSession } from './text-session.js';

describe('editing session run language', () => {
  it('writes a selected range language and removes it with Auto', () => {
    const object = tenPointText('t', '\u4e2d\u6587');
    const { store, context } = createTextModeContext([object]);
    const session = new TextEditingSession(context, object, 0);
    const stored = (): TextObject => store.get('t' as ObjectId) as TextObject;
    try {
      session.selectAll();
      session.setStyle({ lang: 'ja' });
      expect(stored()).toMatchObject({ runs: [{ style: { lang: 'ja' } }] });
      session.setStyle({ lang: null });
      expect(stored().runs[0]?.style).not.toHaveProperty('lang');
    } finally {
      session.end();
      store.destroy();
    }
  });
});
