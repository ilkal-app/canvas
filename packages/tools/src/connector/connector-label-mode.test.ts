import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId } from '@canvas/schema';

import { editingSessionOf } from '../modes/editing-session.js';
import type { ToolPointerInput } from '../modes/tool-mode.js';
import { connector } from '../select/__fixtures__/select-board.js';
import { createTextModeContext, TEN } from '../text/__fixtures__/text-mode-context.js';

import { ConnectorLabelMode } from './connector-label-mode.js';

/** A connector at the origin from the free point (0, 0) to (300, 0), its label "abc". */
const CONNECTOR: ConnectorObject = connector('k', {
  from: { kind: 'point', x: 0, y: 0 },
  to: { kind: 'point', x: 300, y: 0 },
  label: { text: 'abc', runs: [{ length: 3, style: TEN }] },
});

/**
 * A pointer input at zoom 1.
 *
 * @param kind - The kind.
 * @param x - The point's x.
 * @param y - The point's y.
 * @returns The input.
 */
function at(kind: 'pointerDown' | 'pointerUp', x: number, y: number): ToolPointerInput {
  const point = { x, y };
  return { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false, zoom: 1 };
}

describe('ConnectorLabelMode', () => {
  it('edits a connector’s label with the text editor, shown as the connector tool', () => {
    const { context, store } = createTextModeContext([CONNECTOR]);
    // The label "abc" is centred on (150, 0): its text starts at 150 − 9 = 141.
    const mode = new ConnectorLabelMode(context, { id: 'k' as ObjectId, world: { x: 148, y: 0 } });
    expect(mode.id).toBe('connector');
    expect(mode.cursor).toBe('text');
    expect(editingSessionOf(mode)).toBe(mode.session);
    expect(mode.session?.editor.caret).toBe(1);
    mode.session?.type('x');
    expect((store.get('k' as ObjectId) as ConnectorObject).label?.text).toBe('axbc');
    expect(mode.overlay().toolRects?.length).toBeGreaterThan(0);
    mode.onZoom(2);
    expect(mode.onKey({ kind: 'nudge', direction: 'left', isLarge: false })).toBe(true);
    expect(mode.session?.editor.caret).toBe(1);
    // A press off the label ends the editing and is passed on.
    expect(mode.onPointer(at('pointerDown', 500, 300))).toMatchObject({ isDone: true });
    mode.exit();
  });

  it('selects the whole label on Enter, and is abandoned writing nothing more', () => {
    const { context } = createTextModeContext([CONNECTOR]);
    const mode = new ConnectorLabelMode(context, { id: 'k' as ObjectId });
    expect(mode.session?.editor.anchor).toBe(0);
    expect(mode.session?.editor.caret).toBe(3);
    mode.abandon();
  });

  it('has no session for an object that is gone', () => {
    const { context } = createTextModeContext([]);
    expect(new ConnectorLabelMode(context, { id: 'k' as ObjectId }).session).toBeUndefined();
  });
});
