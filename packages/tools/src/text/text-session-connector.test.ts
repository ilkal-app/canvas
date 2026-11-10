// An editing session over a connector's label, as over a shape's: the label is created
// by the first character, written without a size, laid out centred halfway along the route where
// the engine draws it (`connectorLabelPlacement`, on the connector placed on its targets), and the
// caret, the overlay and presses land there; the label follows a target that moves.
import { describe, expect, it } from 'vitest';

import type { ConnectorObject, ObjectId } from '@canvas/schema';

import { connector, group, rect } from '../select/__fixtures__/select-board.js';

import { ADA, createTextModeContext, TEN } from './__fixtures__/text-mode-context.js';
import { isOnSessionBox, sessionCaretBox, sessionOverlayRects } from './text-session-geometry.js';
import { TextEditingSession } from './text-session.js';

/**
 * A straight connector at the origin from rectangle `r` (100 × 50 at the origin) to the free point
 * (300, 25): its route runs from r's right side (100, 25), so its label is centred on (200, 25).
 *
 * @param label - The label's text, or null for none.
 * @returns The connector.
 */
function labelled(label: string | null): ConnectorObject {
  return connector('k', {
    from: { kind: 'object', objectId: 'r' as ObjectId, anchor: null },
    to: { kind: 'point', x: 300, y: 25 },
    label: label === null ? null : { text: label, runs: [{ length: label.length, style: TEN }] },
  });
}

/**
 * A session over the connector's label.
 *
 * @param label - The label's text, or null for none.
 * @param caret - The caret.
 * @returns The store, the session and a reader of the connector.
 */
function connectorSession(label: string | null, caret: number | 'all' = 0) {
  const target = rect('r', null, { x: 0, y: 0, width: 100, height: 50 });
  const fixture = createTextModeContext([target, labelled(label)]);
  const stored = fixture.store.get('k' as ObjectId) as ConnectorObject;
  const session = new TextEditingSession(fixture.context, stored, caret);
  const read = (): ConnectorObject | undefined =>
    fixture.store.get('k' as ObjectId) as ConnectorObject | undefined;
  return { ...fixture, session, read };
}

// 10 px monospaced text: 6 units a character, 12.5 a line. The label box is 200 wide, centred on
// (200, 25): from x 100; "abc" (18 wide) centred in it starts 91 in; its one line is centred on
// the route, from 25 − 6.25.
const BOX_LEFT = 100;
const TEXT_LEFT = BOX_LEFT + 91;
const TEXT_TOP = 25 - 6.25;

describe('TextEditingSession on a connector label', () => {
  it('creates the label with the first character typed, in the typing style', () => {
    const { session, read } = connectorSession(null);
    expect(session.editor.text).toBe('');
    session.type('Hi');
    expect(read()?.label).toEqual({ text: 'Hi', runs: [{ length: 2, style: TEN }] });
  });

  it('places the caret by the text centred halfway along the route', () => {
    const { session } = connectorSession('abc', 0);
    session.placeCaret({ x: TEXT_LEFT + 7, y: TEXT_TOP + 5 }, false);
    expect(session.editor.caret).toBe(1);
    const caret = sessionCaretBox(session);
    expect(caret?.x).toBeCloseTo(TEXT_LEFT + 6, 9);
    expect(caret?.y).toBeCloseTo(TEXT_TOP, 9);
  });

  it('takes presses on the label’s box as the editor’s, and outlines that box', () => {
    const { session } = connectorSession('abc', 0);
    expect(isOnSessionBox(session, { x: BOX_LEFT + 5, y: 25 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: BOX_LEFT - 5, y: 25 }, 0)).toBe(false);
    expect(isOnSessionBox(session, { x: 200, y: 40 }, 0)).toBe(false);
    const [top] = sessionOverlayRects(session, 1);
    expect(top?.box.x).toBeCloseTo(BOX_LEFT - 1, 9);
    expect(top?.box.y).toBeCloseTo(TEXT_TOP - 1, 9);
  });

  it('follows its target: the label box moves with the route', () => {
    const { session, store } = connectorSession('abc', 0);
    store.transact(ADA, (transaction) => {
      transaction.patchObject('r' as ObjectId, { y: 100 });
    });
    // From r's right side (100, 125) to (300, 25): the middle is (200, 75).
    expect(isOnSessionBox(session, { x: 200, y: 75 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: 200, y: 25 }, 0)).toBe(false);
  });

  it('has no box to press while no font lays the label out', () => {
    const { session, context } = connectorSession('abc', 0);
    const unlaid = new TextEditingSession(
      { ...context, layout: { layout: () => undefined } },
      session.object() as ConnectorObject,
      0,
    );
    expect(isOnSessionBox(unlaid, { x: TEXT_LEFT, y: 25 }, 0)).toBe(false);
  });

  it('places a label on a connector attached to a group by the group’s children', () => {
    const target = rect('r', 'g', { x: 0, y: 0, width: 100, height: 50 });
    const onGroup: ConnectorObject = {
      ...labelled('abc'),
      from: { kind: 'object', objectId: 'g' as ObjectId, anchor: null },
    };
    const fixture = createTextModeContext([group('g', null, 0, 0), target, onGroup]);
    const stored = fixture.store.get('k' as ObjectId) as ConnectorObject;
    const session = new TextEditingSession(fixture.context, stored, 0);
    // The group's box is r's: the label is centred on (200, 25) as before.
    expect(isOnSessionBox(session, { x: BOX_LEFT + 5, y: 25 }, 0)).toBe(true);
  });
});
